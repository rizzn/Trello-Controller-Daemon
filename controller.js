const fs = require('fs');
const path = require('path');
const https = require('https');

// 1. Load configuration from the central projects.json
const projectsPath=path.join(__dirname,'projects.json');
let config={};

if(fs.existsSync(projectsPath)) {
	try {
		const projects=JSON.parse(fs.readFileSync(projectsPath,'utf8'));
		const currentPath=process.cwd().replace(/\\/g,'/').toLowerCase();
		const boardContext=process.env.TRELLO_BOARD_CONTEXT;
		
		let matchedKey;
		let matchedProject;
		
		if(boardContext) {
			// Find config directly by board URL/key
			matchedKey=Object.keys(projects).find(k=>k.toLowerCase()===boardContext.toLowerCase()||k.includes(boardContext));
			if(matchedKey) {
				const boardConfig=projects[matchedKey];
				// See if the current directory matches any project under this board to resolve billing path
				if(boardConfig.PROJECTS&&Array.isArray(boardConfig.PROJECTS)) {
					matchedProject=boardConfig.PROJECTS.find(p=>p.folder_path&&p.folder_path.replace(/\\/g,'/').toLowerCase()===currentPath);
					if(!matchedProject&&boardConfig.PROJECTS.length>0) {
						matchedProject=boardConfig.PROJECTS[0];
					}
				}
			}
		}
		
		if(!matchedKey) {
			// Find by matching current folder inside PROJECTS
			matchedKey=Object.keys(projects).find(k=>{
				const boardConfig=projects[k];
				if(boardConfig.PROJECTS&&Array.isArray(boardConfig.PROJECTS)) {
					matchedProject=boardConfig.PROJECTS.find(p=>p.folder_path&&p.folder_path.replace(/\\/g,'/').toLowerCase()===currentPath);
					return !!matchedProject;
				}
				return false;
			});
		}

		if(matchedKey) {
			config=JSON.parse(JSON.stringify(projects[matchedKey]));
			if(!config.TRELLO_BOARD_URL) {
				config.TRELLO_BOARD_URL=matchedKey;
			}
			if(matchedProject) {
				config.BILLING_LOG_FILE=matchedProject.billing_path;
			}
		}
	}
	catch(e) {
		console.error('Error reading central projects.json:',e.message);
	}
}

const KEY=config.TRELLO_KEY;
const TOKEN=config.TRELLO_TOKEN;
let BOARD_URL=config.TRELLO_BOARD_URL;

if(!KEY||!TOKEN||!BOARD_URL) {
	console.error('Error: This project directory is not registered in E:\\.appdata\\.agents\\trello\\projects.json, or configuration values are missing.');
	console.error(`Current directory: ${process.cwd()}`);
	process.exit(1);
}

// Load priority order and label mappings from global controller.json
const globalConfigPath=path.join(__dirname,'controller.json');
let globalConfig={};
if(fs.existsSync(globalConfigPath)) {
	try {
		globalConfig=JSON.parse(fs.readFileSync(globalConfigPath,'utf8'));
	}
	catch(e) {
		console.error('Error reading global controller.json:',e.message);
	}
}

const priorityOrder=globalConfig.priorityOrder||['Important','Bug','Feature','UI/UX','Refactor','Controlling'];
const labelMappings=globalConfig.labelMappings||[];
const INBOX_LIST_NAME=config.TRELLO_LIST_INCOMING||'Incoming Tickets';
const ACTIVE_LIST_NAME=config.TRELLO_LIST_ACTIVE||'Active Tickets';
const COMPLETED_LIST_NAME=config.TRELLO_LIST_COMPLETED||'Completed Tickets';

// Extract Board ID from Board URL if necessary
let boardId = BOARD_URL;
if(BOARD_URL.includes('/b/')) {
    const match = BOARD_URL.match(/\/b\/([^\/]+)/);
    if(match) boardId = match[1];
}

// Helper for HTTPS requests
function apiRequest(method, urlPath, payload = null) {
    return new Promise((resolve, reject) => {
        const querySymbol = urlPath.includes('?') ? '&' : '?';
        const fullPath = `/1${urlPath}${querySymbol}key=${KEY}&token=${TOKEN}`;
        
        const options = {
            hostname: 'api.trello.com',
            port: 443,
            path: fullPath,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if(res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve(data);
                    }
                }
                else {
                    reject(`Trello API Error (${res.statusCode}): ${data}`);
                }
            });
        });

        req.on('error', (e) => reject(e));
        if(payload) req.write(JSON.stringify(payload));
        req.end();
    });
}

// Core functions
async function showBoard() {
    try {
        console.log('Fetching Trello board...');
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        
        for (const list of lists) {
            console.log(`\n\x1b[36m=== List: ${list.name} (ID: ${list.id}) ===\x1b[0m`);
            const cards = await apiRequest('GET', `/lists/${list.id}/cards`);
            if(cards.length === 0) {
                console.log('  (No tasks)');
            }
            else {
                cards.forEach(card => {
                    console.log(`  - [${card.shortLink}] ${card.name}`);
                });
            }
        }
    } catch (error) {
        console.error(error);
    }
}

function parsePrefixAndCleanTitle(title) {
    let cleanTitle = title;
    let matchedLabel = null;
    
    for (const mapping of labelMappings) {
        const keyword = mapping.prefix.replace(/[\[\]]/g, '').trim().toLowerCase();
        const lowerTitle = title.toLowerCase().trim();
        
        const patternBracket = `[${keyword}]`.toLowerCase();
        const patternColon = `${keyword}:`.toLowerCase();
        const patternSpace = `${keyword} `.toLowerCase();
        
        let matched = false;
        let matchLength = 0;
        
        if (lowerTitle.startsWith(patternBracket)) {
            matched = true;
            matchLength = patternBracket.length;
        } else if (lowerTitle.startsWith(patternColon)) {
            matched = true;
            matchLength = patternColon.length;
        } else if (lowerTitle.startsWith(patternSpace)) {
            matched = true;
            matchLength = patternSpace.length;
        }
        
        if (matched) {
            matchedLabel = mapping;
            cleanTitle = title.substring(matchLength).trim();
            break;
        }
    }
    return { cleanTitle, matchedLabel };
}

async function addCard(title, desc = '', listName = '') {
    try {
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        if(lists.length === 0) throw 'No lists found on the board!';
        
        let targetList = lists[0];
        if(listName) {
            const found = lists.find(l => l.name.toLowerCase().includes(listName.toLowerCase()));
            if(found) targetList = found;
        }
        
        const parsed = parsePrefixAndCleanTitle(title);
        const cleanTitle = parsed.cleanTitle;
        const matchedLabel = parsed.matchedLabel;

        console.log(`Creating card in list "${targetList.name}"...`);
        const newCard = await apiRequest('POST', `/cards?idList=${targetList.id}`, {
            name: cleanTitle,
            desc: desc,
            pos: 'top'
        });
        console.log(`\x1b[32mCard successfully created! ID: [${newCard.shortLink}]\x1b[0m`);
        
        if (matchedLabel) {
            console.log(`Adding label "${matchedLabel.name}" (${matchedLabel.color})...`);
            await apiRequest('POST', `/cards/${newCard.id}/labels?color=${matchedLabel.color}&name=${encodeURIComponent(matchedLabel.name)}`);
            console.log('\x1b[32mLabel successfully added!\x1b[0m');
        }
        
        // await sortBoard(); // Automatic sorting disabled
    } catch (error) {
        console.error(error);
    }
}

async function moveCard(cardShortLink, targetListName) {
    try {
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        const targetList = lists.find(l => l.name.toLowerCase().includes(targetListName.toLowerCase()));
        if(!targetList) throw `List "${targetListName}" not found!`;
        
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        
        console.log(`Moving card [${cardShortLink}] "${card.name}" to list "${targetList.name}"...`);
        await apiRequest('PUT', `/cards/${card.id}?idList=${targetList.id}`);
        console.log('\x1b[32mCard successfully moved!\x1b[0m');
    } catch (error) {
        console.error(error);
    }
}

async function syncLocalActiveTicket(card,checklists) {
	const activeTicketPath=path.join(process.cwd(),'active_ticket.json');
	if(fs.existsSync(activeTicketPath)) {
		try {
			const activeTicket=JSON.parse(fs.readFileSync(activeTicketPath,'utf8'));
			if(activeTicket.shortLink===card.shortLink) {
				activeTicket.checklists=checklists.map(cl=>({
					name:cl.name,
					items:cl.checkItems?cl.checkItems.map(item=>({
						name:item.name,
						state:item.state
					})):[]
				}));
				const jsonStr=JSON.stringify(activeTicket,null,'\t').replace(/": /g,'":');
				fs.writeFileSync(activeTicketPath,jsonStr,'utf8');
				console.log('Local active_ticket.json updated.');
			}
		}
		catch(e) {
			// Ignore
		}
	}
}

async function startCard(cardShortLink) {
    try {
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        const targetList = lists.find(l => l.name.toLowerCase().includes(ACTIVE_LIST_NAME.toLowerCase()));
        if(!targetList) throw `List "${ACTIVE_LIST_NAME}" not found!`;
        
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        
        // Embed image attachments into description if present
        await embedMissingImages(card);
        
        console.log(`Moving card [${cardShortLink}] "${card.name}" to list "${targetList.name}"...`);
        await apiRequest('PUT', `/cards/${card.id}?idList=${targetList.id}`);
        
        const timestamp = new Date().toLocaleString('de-DE');
        const commentText = `Processing started at ${timestamp}`;
        console.log(`Adding comment: "${commentText}"`);
        await apiRequest('POST', `/cards/${card.id}/actions/comments`, { text: commentText });
        
        console.log('\x1b[32mCard successfully started!\x1b[0m');
        
        // Create active_ticket.json for AI assistant context
        console.log('Retrieving checklists for the ticket...');
        const checklists = await apiRequest('GET', `/cards/${card.id}/checklists`);
        
        const activeTicket = {
            shortLink:card.shortLink,
            id:card.id,
            title:card.name,
            description:card.desc||'',
            url:card.shortUrl,
            labels:card.labels?card.labels.map(l=>l.name):[],
            checklists:checklists.map(cl=>({
                name:cl.name,
                items:cl.checkItems?cl.checkItems.map(item=>({
                    name:item.name,
                    state:item.state
                })):[]
            })),
            startedAt:timestamp
        };
        
        const jsonStr = JSON.stringify(activeTicket, null, '\t').replace(/": /g, '":');
        fs.writeFileSync(path.join(process.cwd(), 'active_ticket.json'), jsonStr, 'utf8');
        console.log('\x1b[32mactive_ticket.json successfully created in the workspace!\x1b[0m');
        
        // await sortBoard(); // Automatic sorting disabled
    } catch (error) {
        console.error(error);
    }
}

async function archiveCard(cardShortLink) {
    try {
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        console.log(`Archiving card [${cardShortLink}] "${card.name}"...`);
        await apiRequest('PUT', `/cards/${card.id}?closed=true`);
        console.log('\x1b[32mCard successfully archived!\x1b[0m');
    } catch (error) {
        console.error(error);
    }
}

async function deleteCard(cardShortLink) {
    try {
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        console.log(`Deleting card [${cardShortLink}] "${card.name}" permanently...`);
        await apiRequest('DELETE', `/cards/${card.id}`);
        console.log('\x1b[32mCard successfully deleted!\x1b[0m');
    } catch (error) {
        console.error(error);
    }
}

async function addLabel(cardShortLink, color, name = '') {
    try {
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        console.log(`Adding label "${color}" (${name || 'no name'}) to card [${cardShortLink}]...`);
        await apiRequest('POST', `/cards/${card.id}/labels?color=${color}&name=${name}`);
        console.log('\x1b[32mLabel successfully added!\x1b[0m');
    } catch (error) {
        console.error(error);
    }
}

async function addComment(cardShortLink, text) {
    try {
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        console.log(`Adding comment to card [${cardShortLink}]...`);
        await apiRequest('POST', `/cards/${card.id}/actions/comments`, { text: text });
        console.log('\x1b[32mComment successfully added!\x1b[0m');
    } catch (error) {
        console.error(error);
    }
}

async function addCheckItem(cardShortLink, itemName) {
    try {
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        const checklists = await apiRequest('GET', `/cards/${card.id}/checklists`);
        let checklist = checklists[0];
        if(!checklist) {
            console.log('Creating new checklist "Tasks"...');
            checklist = await apiRequest('POST', `/cards/${card.id}/checklists`, { name: 'Tasks' });
        }
        console.log(`Adding "${itemName}" to checklist "${checklist.name}"...`);
        await apiRequest('POST', `/checklists/${checklist.id}/checkItems`, { name: itemName });
        console.log('\x1b[32mChecklist item successfully added!\x1b[0m');
        
        // Sync local active_ticket.json
        const updatedChecklists = await apiRequest('GET', `/cards/${card.id}/checklists`);
        await syncLocalActiveTicket(card, updatedChecklists);
    } catch (error) {
        console.error(error);
    }
}

async function completeCheckItem(cardShortLink, itemName) {
    try {
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        const checklists = await apiRequest('GET', `/cards/${card.id}/checklists`);
        let foundItem = null;
        for(const cl of checklists) {
            const item = cl.checkItems.find(i => i.name.toLowerCase().includes(itemName.toLowerCase()));
            if(item) {
                foundItem = { checklistId: cl.id, item: item };
                break;
            }
        }
        if(!foundItem) throw `Checklist item "${itemName}" not found!`;
        console.log(`Marking "${foundItem.item.name}" as completed...`);
        await apiRequest('PUT', `/cards/${card.id}/checkItem/${foundItem.item.id}`, { state: 'complete' });
        console.log('\x1b[32mChecklist item marked as completed!\x1b[0m');
        
        // Sync local active_ticket.json
        const updatedChecklists = await apiRequest('GET', `/cards/${card.id}/checklists`);
        await syncLocalActiveTicket(card, updatedChecklists);
    } catch (error) {
        console.error(error);
    }
}

async function searchCards(query) {
    try {
        console.log(`Searching for "${query}" on the board...`);
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        const cards = await apiRequest('GET', `/boards/${boardId}/cards`);
        const matches = cards.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || (c.desc && c.desc.toLowerCase().includes(query.toLowerCase())));
        if(matches.length === 0) {
            console.log('No matching cards found.');
            return;
        }
        matches.forEach(card => {
            const list = lists.find(l => l.id === card.idList);
            console.log(`\n\x1b[36m- [${card.shortLink}] ${card.name}\x1b[0m`);
            console.log(`  List: ${list ? list.name : 'Unknown'}`);
            if(card.desc) console.log(`  Description: ${card.desc.substring(0, 100)}...`);
        });
    } catch (error) {
        console.error(error);
    }
}

function getCardWeight(card) {
    let minWeight = priorityOrder.length + 1;
    if (card.labels) {
        for (const label of card.labels) {
            const index = priorityOrder.indexOf(label.name);
            if (index !== -1) {
                minWeight = Math.min(minWeight, index + 1);
            }
        }
    }
    return minWeight;
}

async function sortBoard() {
    try {
        console.log('Retrieving lists from Trello board...');
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        
        for (const list of lists) {
            console.log(`\nChecking list: "${list.name}"...`);
            const cards = await apiRequest('GET', `/lists/${list.id}/cards`);
            if (cards.length <= 1) {
                console.log('  Too few cards to sort.');
                continue;
            }
            
            const sortedCards = [...cards].sort((a, b) => {
                const wA = getCardWeight(a);
                const wB = getCardWeight(b);
                if (wA !== wB) return wA - wB;
                return a.pos - b.pos;
            });
            
            let isSorted = true;
            for (let i = 0; i < cards.length; i++) {
                if (cards[i].id !== sortedCards[i].id) {
                    isSorted = false;
                    break;
                }
            }
            
            if (isSorted) {
                console.log('  List is already correctly sorted.');
                continue;
            }
            
            console.log(`  Sorting ${sortedCards.length} cards in the list...`);
            for (let i = 0; i < sortedCards.length; i++) {
                const card = sortedCards[i];
                const newPos = i + 1;
                console.log(`    Moving card [${card.shortLink}] "${card.name}" to position ${newPos}...`);
                await apiRequest('PUT', `/cards/${card.id}`, { pos: newPos });
            }
            console.log(`  List "${list.name}" successfully sorted.`);
        }
        console.log('\n\x1b[32mAll lists successfully sorted!\x1b[0m');
    } catch (error) {
        console.error('Error sorting the board:', error);
    }
}

async function backupBoard() {
    try {
        console.log('Creating backup of Trello board...');
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        let output = `Trello Board Backup - ${new Date().toLocaleString('en-US')}\n`;
        output += `===============================================\n`;
        
        for (const list of lists) {
            output += `\n=== List: ${list.name} (ID: ${list.id}) ===\n`;
            const cards = await apiRequest('GET', `/lists/${list.id}/cards`);
            if(cards.length === 0) {
                output += '  (No tasks)\n';
            }
            else {
                cards.forEach(card => {
                    output += `  - [${card.shortLink}] ${card.name}\n`;
                    if (card.desc) {
                        output += `    Description: ${card.desc.replace(/\\r?\\n/g, '\\n    ')}\n`;
                    }
                });
            }
        }
        
        // Save backup to the local project .agents/ folder if present, otherwise next to the script
		let backupFilePath=path.join(process.cwd(),'.agents','board_backup.txt');
		if(!fs.existsSync(path.dirname(backupFilePath))) {
			backupFilePath=path.join(__dirname,'board_backup.txt');
		}
        
        fs.writeFileSync(backupFilePath, output, 'utf8');
        console.log(`\x1b[32mBackup successfully saved to ${backupFilePath}!\x1b[0m`);
    } catch (error) {
        console.error(error);
    }
}

async function embedMissingImages(card) {
	try {
		const attachments=await apiRequest('GET',`/cards/${card.id}/attachments`);
		const imageAttachments=attachments.filter(a=>a.mimeType&&a.mimeType.startsWith('image/'));
		if(imageAttachments.length>0) {
			let desc=card.desc||'';
			const missingImages=imageAttachments.filter(img=>!desc.includes(img.url));
			if(missingImages.length>0) {
				console.log(`  -> Embedding ${missingImages.length} image attachment(s) into description...`);
				desc=desc.trim();
				desc+='\n\n---\n### 📎 Image Attachments:\n';
				for(const img of missingImages) {
					desc+=`![${img.name}](${img.url})\n`;
				}
				await apiRequest('PUT',`/cards/${card.id}`,{desc:desc});
				card.desc=desc;
			}
		}
	}
	catch(e) {
		console.error(`  -> Error embedding images for card ${card.shortLink}:`,e.message);
	}
}

async function processInbox() {
    try {
        console.log(`Retrieving lists to find inbox "${INBOX_LIST_NAME}"...`);
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        const inboxList = lists.find(l => l.name.toLowerCase().includes(INBOX_LIST_NAME.toLowerCase()));
        if (!inboxList) {
            console.error(`Error: Inbox list "${INBOX_LIST_NAME}" not found.`);
            return;
        }
        
        console.log(`Fetching cards from inbox list "${inboxList.name}"...`);
        const cards = await apiRequest('GET', `/lists/${inboxList.id}/cards`);
        
        if (cards.length === 0) {
            console.log('No new email tickets in the inbox.');
            return;
        }
        
        console.log(`Found ${cards.length} ticket(s) in the inbox. Processing...`);
        
        for (const card of cards) {
            console.log(`\nProcessing ticket: "${card.name}" [${card.shortLink}]`);
            
            // Embed images
            await embedMissingImages(card);
            
            const { cleanTitle, matchedLabel } = parsePrefixAndCleanTitle(card.name);
            
            // 1. Update title if changed (prefix removed)
            if (cleanTitle !== card.name) {
                console.log(`  -> Changing title to: "${cleanTitle}"`);
                await apiRequest('PUT', `/cards/${card.id}`, { name: cleanTitle });
            }
            
            // 2. Assign label if matched
            if (matchedLabel) {
                const hasLabel = card.labels && card.labels.some(l => l.name === matchedLabel.name);
                if (!hasLabel) {
                    console.log(`  -> Assigning label "${matchedLabel.name}" (${matchedLabel.color})...`);
                    await apiRequest('POST', `/cards/${card.id}/labels?color=${matchedLabel.color}&name=${encodeURIComponent(matchedLabel.name)}`);
                }
            }
            
            // 3. Move to target list (disabled - user moves cards manually)
            // console.log(`  -> Moving card to list "${targetList.name}"...`);
            // await apiRequest('PUT', `/cards/${card.id}?idList=${targetList.id}`);
        }
        
        // console.log('\nSorting the board by priority...');
        // await sortBoard(); // Automatic sorting disabled
        console.log('\x1b[32mInbox processing completed successfully!\x1b[0m');
    } catch (error) {
        console.error('Error during inbox processing:', error);
    }
}

async function syncLabelsAndCards() {
	try {
		console.log('Syncing global labels with Trello board...');
		const boardLabels=await apiRequest('GET',`/boards/${boardId}/labels`);
		
		for(const mapping of labelMappings) {
			const existingLabel=boardLabels.find(l=>l.name.toLowerCase()===mapping.name.toLowerCase());
			
			if(existingLabel) {
				if(existingLabel.color!==mapping.color) {
					console.log(`  -> Updating label color for "${mapping.name}" to ${mapping.color}...`);
					await apiRequest('PUT',`/labels/${existingLabel.id}`,{color:mapping.color});
				}
			}
			else {
				console.log(`  -> Creating new label "${mapping.name}" (${mapping.color}) on the board...`);
				await apiRequest('POST',`/boards/${boardId}/labels`,{name:mapping.name,color:mapping.color});
			}
		}
		
		console.log('Checking and cleaning card titles and labels board-wide...');
		const cards=await apiRequest('GET',`/boards/${boardId}/cards`);
		const updatedLabels=await apiRequest('GET',`/boards/${boardId}/labels`);
		
		for(const card of cards) {
			const {cleanTitle,matchedLabel}=parsePrefixAndCleanTitle(card.name);
			
			if(cleanTitle!==card.name) {
				console.log(`  -> Adjusting title for [${card.shortLink}]: "${cleanTitle}"`);
				await apiRequest('PUT',`/cards/${card.id}`,{name:cleanTitle});
			}
			
			if(matchedLabel) {
				const boardLabel=updatedLabels.find(l=>l.name.toLowerCase()===matchedLabel.name.toLowerCase());
				const hasLabel=card.idLabels&&card.idLabels.includes(boardLabel.id);
				
				if(!hasLabel&&boardLabel) {
					console.log(`  -> Assigning label "${boardLabel.name}" to card [${card.shortLink}]...`);
					await apiRequest('POST',`/cards/${card.id}/idLabels`,{value:boardLabel.id});
				}
			}
		}
		console.log('\x1b[32mBoard sync completed successfully!\x1b[0m');
	}
	catch(error) {
		console.error('Error during synchronization:',error);
	}
}

async function listenInbox(intervalMinutes = 5) {
    console.log(`\n\x1b[35m=== Trello Inbox Polling Daemon Started ===\x1b[0m`);
    console.log(`Monitoring list: "${INBOX_LIST_NAME}"`);
    console.log(`Interval: every ${intervalMinutes} minutes`);
    console.log(`Press Ctrl+C to terminate.\n`);
    
    // First run immediately
    await processInbox();
    
    setInterval(async () => {
        const timestamp = new Date().toLocaleString('de-DE');
        console.log(`\n[${timestamp}] Checking inbox...`);
        await processInbox();
    }, intervalMinutes * 60000);
}

async function completeSession(cardShortLink, manualTimeEstimate = '') {
    try {
        // 1. Fetch and move the Trello card
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        const targetList = lists.find(l => l.name.toLowerCase().includes(COMPLETED_LIST_NAME.toLowerCase())) ||
                           lists.find(l => l.name.toLowerCase().includes('implemented') || l.name.toLowerCase().includes('done') || l.name.toLowerCase().includes('completed') || l.name.toLowerCase().includes('complete'));
        if(!targetList) throw `No matching list ("${COMPLETED_LIST_NAME}", "Implemented", "Completed", or "Done") found!`;
        
        console.log(`Moving card [${cardShortLink}] "${card.name}" to list "${targetList.name}"...`);
        await apiRequest('PUT', `/cards/${card.id}?idList=${targetList.id}`);
        
        // Delete local active_ticket.json if present
        const activeTicketPath = path.join(process.cwd(), 'active_ticket.json');
        if(fs.existsSync(activeTicketPath)) {
            try {
                fs.unlinkSync(activeTicketPath);
                console.log('Local active_ticket.json deleted.');
            } catch (e) {
                // Ignore
            }
        }
        
        // 2. Read billing log (try local project folder first, fallback to script directory)
		const logFilename=config.BILLING_LOG_FILE||'billing-log.md';
		let billingLogPath;
		if(path.isAbsolute(logFilename)) {
			billingLogPath=logFilename;
		}
		else {
			billingLogPath=path.join(process.cwd(),'.agents','billing',logFilename);
			if(!fs.existsSync(billingLogPath)) {
				billingLogPath=path.join(__dirname,'..','billing',logFilename);
			}
		}
        
        if(!fs.existsSync(billingLogPath)) {
            console.log('Notice: billing log file does not exist, skipping automatic log entry.');
            return;
        }
        
        let content = fs.readFileSync(billingLogPath, 'utf8');
        
        // Find the active session line in the logbook
        const lines = content.split(/\r?\n/);
        let activeLineIndex = -1;
        let startTimeStr = '';
        let dateStr = '';
        
        for(let i = 0; i < lines.length; i++) {
            if(lines[i].includes('*Aktiv*') || lines[i].includes('In Arbeit')) {
                activeLineIndex = i;
                const cols = lines[i].split('|').map(c => c.trim());
                if(cols.length >= 7) {
                    dateStr = cols[1];
                    startTimeStr = cols[2];
                }
                break;
            }
        }
        
        if(activeLineIndex === -1) {
            console.log('No active session found in the logbook. Card moved, log untouched.');
            return;
        }
        
        // 3. Calculate session duration
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const endTimeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        
        const [startH, startM] = startTimeStr.split(':').map(Number);
        const start = new Date(now);
        start.setHours(startH, startM, 0, 0);
        let diffMs = now - start;
        if(diffMs < 0) diffMs += 24 * 60 * 60 * 1000;
        const durationMin = Math.round(diffMs / 60000);
        
        let estHours = Math.ceil((durationMin * 7.5) / 10) * 10;
        if(estHours < 30) estHours = 45;
        const actualTimeText = `${durationMin} Min.`;
        
        let estTimeText = manualTimeEstimate;
        if(!estTimeText) {
            if(estHours >= 60) {
                estTimeText = `${Math.floor(estHours / 60)} Std. ${estHours % 60 ? (estHours % 60) + ' Min.' : ''}`;
            }
            else {
                estTimeText = `${estHours} Min.`;
            }
        }
        
        // Update the session line in the logbook
        lines[activeLineIndex] = `| ${dateStr} | ${startTimeStr} | ${endTimeStr} | ${actualTimeText} | ${estTimeText} | Erledigt (${card.name}) |`;
        
        // 4. Generate billing item entry
        const billingItem = `
### [${dateStr}] Session: ${card.name}
*   **Tatsächliche Entwicklungszeit mit KI & Review:** ${actualTimeText} (${startTimeStr} - ${endTimeStr} Uhr)
*   **Geschätzte manuelle Entwicklungszeit ohne KI:** ca. ${estTimeText}

#### Rechnungsposition:
*   **Titel:** ${card.name}
*   **Details:**
    *   ${card.desc || 'Implementierung und Verifizierung des Features gemäß Spezifikation.'}
*   **Nutzen für den Kunden:** Effiziente Bereitstellung des Features mit modernsten Webtechnologien und minimalen Ladezeiten.

---`;
        
        let newContent = lines.join('\n');
        newContent = newContent.trim() + '\n\n' + billingItem.trim() + '\n';
        
        fs.writeFileSync(billingLogPath, newContent, 'utf8');
        console.log('\x1b[32mSession successfully completed and documented in the billing log!\x1b[0m');
    } catch (error) {
        console.error(error);
    }
}

// CLI Command Parser
const args = process.argv.slice(2);
const command = args[0] ? args[0].toLowerCase() : 'list';

if(command === 'list') {
    showBoard();
}
else if(command === 'add') {
    const title = args[1];
    const desc = args[2] || '';
    const listName = args[3] || '';
    if(!title) {
        console.error('Usage: node trello.js add "Card Title" ["Card Description"] ["ListName"]');
        process.exit(1);
    }
    addCard(title, desc, listName);
}
else if(command === 'move') {
    const cardLink = args[1];
    const listName = args[2];
    if(!cardLink || !listName) {
        console.error('Usage: node trello.js move "shortLink" "ListName"');
        process.exit(1);
    }
    moveCard(cardLink, listName);
}
else if(command === 'archive') {
    const cardLink = args[1];
    if(!cardLink) {
        console.error('Usage: node trello.js archive "shortLink"');
        process.exit(1);
    }
    archiveCard(cardLink);
}
else if(command === 'delete') {
    const cardLink = args[1];
    if(!cardLink) {
        console.error('Usage: node trello.js delete "shortLink"');
        process.exit(1);
    }
    deleteCard(cardLink);
}
else if(command === 'label') {
    const cardLink = args[1];
    const color = args[2];
    const labelName = args[3] || '';
    if(!cardLink || !color) {
        console.error('Usage: node trello.js label "shortLink" "Color" ["LabelName"]');
        process.exit(1);
    }
    addLabel(cardLink, color, labelName);
}
else if(command === 'comment') {
    const cardLink = args[1];
    const text = args[2];
    if(!cardLink || !text) {
        console.error('Usage: node trello.js comment "shortLink" "CommentText"');
        process.exit(1);
    }
    addComment(cardLink, text);
}
else if(command === 'check') {
    const cardLink = args[1];
    const itemName = args[2];
    if(!cardLink || !itemName) {
        console.error('Usage: node trello.js check "shortLink" "TaskName"');
        process.exit(1);
    }
    addCheckItem(cardLink, itemName);
}
else if(command === 'check-done') {
    const cardLink = args[1];
    const itemName = args[2];
    if(!cardLink || !itemName) {
        console.error('Usage: node trello.js check-done "shortLink" "TaskName"');
        process.exit(1);
    }
    completeCheckItem(cardLink, itemName);
}
else if(command === 'search') {
    const query = args[1];
    if(!query) {
        console.error('Usage: node trello.js search "SearchTerm"');
        process.exit(1);
    }
    searchCards(query);
}
else if(command === 'complete') {
    const cardLink = args[1];
    const manualTimeEstimate = args[2] || '';
    if(!cardLink) {
        console.error('Usage: node trello.js complete "shortLink" ["ManualTimeEstimate"]');
        process.exit(1);
    }
    completeSession(cardLink, manualTimeEstimate);
}
else if(command === 'backup') {
    backupBoard();
}
else if(command === 'sort') {
    sortBoard();
}
else if(command === 'start') {
    const cardLink = args[1];
    if(!cardLink) {
        console.error('Usage: node trello.js start "shortLink"');
        process.exit(1);
    }
    startCard(cardLink);
}
else if(command === 'inbox') {
    processInbox();
}
else if(command === 'sync') {
    syncLabelsAndCards();
}
else if(command === 'listen') {
    const interval = parseInt(args[1]) || 5;
    listenInbox(interval);
}
else {
    console.log('Unknown command. Available: list, add, move, start, archive, delete, label, comment, check, check-done, search, complete, backup, sort, inbox, listen, sync');
}
