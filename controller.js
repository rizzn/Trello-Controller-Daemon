const fs = require('fs');
const path = require('path');
const https = require('https');
const {execSync} = require('child_process');

// 1. Load configuration from the central projects.json
const projectsPath=path.join(__dirname,'projects.json');
let config={};
let projects={};

if(fs.existsSync(projectsPath)) {
	try {
		projects=JSON.parse(fs.readFileSync(projectsPath,'utf8'));
		const boards=projects.TRELLO_BOARDS||{};
		const currentPath=process.cwd().replace(/\\/g,'/').toLowerCase();
		const boardContext=process.env.TRELLO_BOARD_CONTEXT;
		
		let matchedKey;
		let matchedProject;
		
		if(boardContext) {
			// Find config directly by board URL/key
			matchedKey=Object.keys(boards).find(k=>k.toLowerCase()===boardContext.toLowerCase()||k.includes(boardContext));
			if(matchedKey) {
				const boardConfig=boards[matchedKey];
				// See if the current directory matches any project under this board to resolve billing path
				if(boardConfig.LOCAL_PROJECTS&&Array.isArray(boardConfig.LOCAL_PROJECTS)) {
					matchedProject=boardConfig.LOCAL_PROJECTS.find(p=>p.folder_path&&p.folder_path.replace(/\\/g,'/').toLowerCase()===currentPath);
					if(!matchedProject&&boardConfig.LOCAL_PROJECTS.length>0) {
						matchedProject=boardConfig.LOCAL_PROJECTS[0];
					}
				}
			}
		}
		
		if(!matchedKey) {
			// Find by matching current folder inside LOCAL_PROJECTS
			matchedKey=Object.keys(boards).find(k=>{
				const boardConfig = boards[k];
				if(boardConfig.LOCAL_PROJECTS && Array.isArray(boardConfig.LOCAL_PROJECTS)) {
					matchedProject = boardConfig.LOCAL_PROJECTS.find(p => p.folder_path && p.folder_path.replace(/\\/g,'/').toLowerCase() === currentPath);
					return !!matchedProject;
				}
				return false;
			});
		}

		if(matchedKey) {
			config = JSON.parse(JSON.stringify(boards[matchedKey]));
			if(!config.TRELLO_BOARD_URL) {
				config.TRELLO_BOARD_URL = matchedKey;
			}
			if(matchedProject) {
				config.BILLING_LOG_FILE = matchedProject.billing_path;
				config.PROJECT_NAME = matchedProject.name;
			}
		}
	}
	catch(e) {
		console.error('Error reading central projects.json:',e.message);
	}
}

const args = process.argv.slice(2);
const command = args[0] ? args[0].toLowerCase() : 'list';

const KEY = config.TRELLO_KEY || projects.TRELLO_KEY;
const TOKEN = config.TRELLO_TOKEN || projects.TRELLO_TOKEN;
let BOARD_URL = config.TRELLO_BOARD_URL;

const isGlobalCommand = ['status','projects','news','unread'].includes(command);

if(!isGlobalCommand && (!KEY || !TOKEN || !BOARD_URL)) {
	console.error(`Error: This project directory is not registered in ${projectsPath}, or configuration values are missing.`);
	console.error(`Current directory: ${process.cwd()}`);
	process.exit(1);
}

// Load priority order and label mappings from global controller.json
const globalConfigPath = path.join(__dirname,'controller.json');
let globalConfig = {};
if(fs.existsSync(globalConfigPath)) {
	try {
		globalConfig = JSON.parse(fs.readFileSync(globalConfigPath,'utf8'));
	}
	catch(e) {
		console.error('Error reading global controller.json:',e.message);
	}
}

const priorityOrder = globalConfig.priorityOrder || ['Important','Bug','Feature','UI/UX','Refactor','Controlling'];
const labelMappings = globalConfig.labelMappings || [];
const messages = globalConfig.messages || {};
const MSG_TICKET_REOPENED = messages.ticketReopened || "🔄 Ticket automatically reopened: A new email response was received.";
const MSG_EMAIL_UPDATE = messages.emailUpdateReceived || "✉️ Email update received for ticket:";
const MSG_EMAIL_CONTENT = messages.emailContentHeader || "Email Content";
const MSG_NO_EMAIL_CONTENT = messages.noEmailContent || "No email content";
const MSG_PROCESSING_STARTED=messages.processingStarted||"Processing started at {timestamp}";
const MSG_PROCESSING_COMPLETED=messages.processingCompleted||"Processing completed at {timestamp}. Estimated effort: {estimated_duration}.";
const INBOX_LIST_NAME=config.TRELLO_LIST_INCOMING||'Incoming Tickets';
const ACTIVE_LIST_NAME=config.TRELLO_LIST_ACTIVE||'Active Tickets';
const COMPLETED_LIST_NAME=config.TRELLO_LIST_COMPLETED||'Completed Tickets';

// Extract Board ID from Board URL if necessary
let boardId=BOARD_URL;
if(BOARD_URL&&BOARD_URL.includes('/b/')) {
	const match=BOARD_URL.match(/\/b\/([^\/]+)/);
	if(match) boardId=match[1];
}

// Helper for HTTPS requests
function apiRequest(method,urlPath,payload=null) {
	return new Promise((resolve,reject)=>{
		const querySymbol=urlPath.includes('?')?'&':'?';
		const fullPath=`/1${urlPath}${querySymbol}key=${KEY}&token=${TOKEN}`;
		
		const options={
			hostname:'api.trello.com',
			port:443,
			path:fullPath,
			method:method,
			headers:{
				'Content-Type':'application/json'
			}
		};

		const req=https.request(options,res=>{
			let data='';
			res.on('data',chunk=>data+=chunk);
			res.on('end',()=>{
				if(res.statusCode>=200&&res.statusCode<300) {
					try {
						resolve(JSON.parse(data));
					} catch(e) {
						resolve(data);
					}
				} else {
					reject(`Trello API Error (${res.statusCode}): ${data}`);
				}
			});
		});

		req.on('error',e=>reject(e));
		if(payload) req.write(JSON.stringify(payload));
		req.end();
	});
}

function getEmlContent(cardId,attachmentId,fileName) {
	return new Promise((resolve,reject)=>{
		const fullPath=`/1/cards/${cardId}/attachments/${attachmentId}/download/${encodeURIComponent(fileName)}`;
		const options={
			hostname:'api.trello.com',
			port:443,
			path:fullPath,
			method:'GET',
			headers:{
				'Authorization':`OAuth oauth_consumer_key="${KEY}", oauth_token="${TOKEN}"`
			}
		};
		const handleResponse=(res)=>{
			if(res.statusCode===301||res.statusCode===302) {
				const redirectUrl=res.headers.location;
				https.get(redirectUrl,handleResponse).on('error',reject);
				return;
			}
			if(res.statusCode>=200&&res.statusCode<300) {
				let data='';
				res.on('data',chunk=>data+=chunk);
				res.on('end',()=>resolve(data));
			}else {
				reject(new Error(`Failed to download EML: Status ${res.statusCode}`));
			}
		};
		https.get(options,handleResponse).on('error',reject);
	});
}

// Core functions
function printContext() {
	console.log('\x1b[35m==================================================\x1b[0m');
	console.log('\x1b[35m⚡ TRELLO CONTROLLER - ACTIVE CONTEXT ⚡\x1b[0m');
	console.log('\x1b[35m==================================================\x1b[0m');
	if(config.PROJECT_NAME) {
		console.log(`\x1b[36mProject:\x1b[0m    ${config.PROJECT_NAME}`);
	} else {
		console.log('\x1b[36mProject:\x1b[0m    Unregistered Workspace');
	}
	console.log(`\x1b[36mBoard URL:\x1b[0m  ${BOARD_URL}`);
	const logFilename = config.BILLING_LOG_FILE || 'billing-log.md';
	let billingLogPath;
	if(path.isAbsolute(logFilename)) {
		billingLogPath = logFilename;
	} else {
		billingLogPath = path.join(process.cwd(),'.agents','billing',logFilename);
		if(!fs.existsSync(billingLogPath)) {
			billingLogPath = path.join(__dirname,'..','billing',logFilename);
		}
	}
	const hasLog = fs.existsSync(billingLogPath);
	console.log(`\x1b[36mLog File:\x1b[0m   ${billingLogPath} (${hasLog?'\x1b[32mExists\x1b[0m':'\x1b[31mNot Found\x1b[0m'})`);
	console.log('\x1b[35m==================================================\x1b[0m\n');
}

async function showBoard() {
	try {
		printContext();
		console.log('Fetching Trello board...');
		const lists = await apiRequest('GET',`/boards/${boardId}/lists`);
		
		for(const list of lists) {
			console.log(`\n\x1b[36m=== List: ${list.name} (ID: ${list.id}) ===\x1b[0m`);
			const cards = await apiRequest('GET',`/lists/${list.id}/cards`);
			if(cards.length === 0) {
				console.log('  (No tasks)');
			} else {
				cards.forEach(card => {
					console.log(`  - [${card.shortLink}] ${card.name}`);
				});
			}
		}
	} catch(error) {
		console.error(error);
	}
}

function parsePrefixAndCleanTitle(title) {
	let cleanTitle=title;
	let matchedLabel=null;
	
	for(const mapping of labelMappings) {
		const keyword=mapping.prefix.replace(/[\[\]]/g,'').trim().toLowerCase();
		const lowerTitle=title.toLowerCase().trim();
		
		const patternBracket=`[${keyword}]`.toLowerCase();
		const patternColon=`${keyword}:`.toLowerCase();
		const patternSpace=`${keyword} `.toLowerCase();
		
		let matched=false;
		let matchLength=0;
		
		if(lowerTitle.startsWith(patternBracket)) {
			matched=true;
			matchLength=patternBracket.length;
		} else if(lowerTitle.startsWith(patternColon)) {
			matched=true;
			matchLength=patternColon.length;
		} else if(lowerTitle.startsWith(patternSpace)) {
			matched=true;
			matchLength=patternSpace.length;
		}
		
		if(matched) {
			matchedLabel=mapping;
			cleanTitle=title.substring(matchLength).trim();
			break;
		}
	}
	return {cleanTitle,matchedLabel};
}

async function addCard(title,desc='',listName='') {
	try {
		const lists=await apiRequest('GET',`/boards/${boardId}/lists`);
		if(lists.length===0) throw 'No lists found on the board!';
		
		let targetList=lists[0];
		if(listName) {
			const found=lists.find(l=>l.name.toLowerCase().includes(listName.toLowerCase()));
			if(found) targetList=found;
		}
		
		const parsed=parsePrefixAndCleanTitle(title);
		const cleanTitle=parsed.cleanTitle;
		const matchedLabel=parsed.matchedLabel;

		console.log(`Creating card in list "${targetList.name}"...`);
		const newCard=await apiRequest('POST',`/cards?idList=${targetList.id}`,{
			name:cleanTitle,
			desc:desc,
			pos:'top'
		});
		console.log(`\x1b[32mCard successfully created! ID: [${newCard.shortLink}]\x1b[0m`);
		
		if(matchedLabel) {
			console.log(`Adding label "${matchedLabel.name}" (${matchedLabel.color})...`);
			await apiRequest('POST',`/cards/${newCard.id}/labels?color=${matchedLabel.color}&name=${encodeURIComponent(matchedLabel.name)}`);
			console.log('\x1b[32mLabel successfully added!\x1b[0m');
		}
	} catch(error) {
		console.error(error);
	}
}

async function moveCard(cardShortLink,targetListName) {
	try {
		const lists=await apiRequest('GET',`/boards/${boardId}/lists`);
		const targetList=lists.find(l=>l.name.toLowerCase().includes(targetListName.toLowerCase()));
		if(!targetList) throw `List "${targetListName}" not found!`;
		
		const card=await apiRequest('GET',`/cards/${cardShortLink}`);
		
		console.log(`Moving card [${cardShortLink}] "${card.name}" to list "${targetList.name}"...`);
		await apiRequest('PUT',`/cards/${card.id}?idList=${targetList.id}&pos=top`);
		console.log('\x1b[32mCard successfully moved!\x1b[0m');
	} catch(error) {
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
		const lists=await apiRequest('GET',`/boards/${boardId}/lists`);
		const targetList=lists.find(l=>l.name.toLowerCase().includes(ACTIVE_LIST_NAME.toLowerCase()));
		if(!targetList) throw `List "${ACTIVE_LIST_NAME}" not found!`;
		
		const card=await apiRequest('GET',`/cards/${cardShortLink}`);
		
		// Embed image attachments into description if present
		await embedMissingImages(card);
		
		console.log(`Moving card [${cardShortLink}] "${card.name}" to list "${targetList.name}"...`);
		await apiRequest('PUT',`/cards/${card.id}?idList=${targetList.id}&pos=top`);
		
		const timestamp=new Date().toLocaleString('de-DE');
		const commentText=MSG_PROCESSING_STARTED.replace('{timestamp}',timestamp);
		console.log(`Adding comment: "${commentText}"`);
		await apiRequest('POST',`/cards/${card.id}/actions/comments`,{text:commentText});
		
		console.log('\x1b[32mCard successfully started!\x1b[0m');
		
		// Create active_ticket.json for AI assistant context
		console.log('Retrieving checklists for the ticket...');
		const checklists=await apiRequest('GET',`/cards/${card.id}/checklists`);
		
		const activeTicket={
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
		
		const jsonStr=JSON.stringify(activeTicket,null,'\t').replace(/": /g,'":');
		fs.writeFileSync(path.join(process.cwd(),'active_ticket.json'),jsonStr,'utf8');
		console.log('\x1b[32mactive_ticket.json successfully created in the workspace!\x1b[0m');
	} catch(error) {
		console.error(error);
	}
}

async function archiveCard(cardShortLink) {
	try {
		const card=await apiRequest('GET',`/cards/${cardShortLink}`);
		console.log(`Archiving card [${cardShortLink}] "${card.name}"...`);
		await apiRequest('PUT',`/cards/${card.id}?closed=true`);
		console.log('\x1b[32mCard successfully archived!\x1b[0m');
	} catch(error) {
		console.error(error);
	}
}

async function deleteCard(cardShortLink) {
	try {
		const card=await apiRequest('GET',`/cards/${cardShortLink}`);
		console.log(`Deleting card [${cardShortLink}] "${card.name}" permanently...`);
		await apiRequest('DELETE',`/cards/${card.id}`);
		console.log('\x1b[32mCard successfully deleted!\x1b[0m');
	} catch(error) {
		console.error(error);
	}
}

async function addLabel(cardShortLink,color,name='') {
	try {
		const card=await apiRequest('GET',`/cards/${cardShortLink}`);
		console.log(`Adding label "${color}" (${name||'no name'}) to card [${cardShortLink}]...`);
		await apiRequest('POST',`/cards/${card.id}/labels?color=${color}&name=${name}`);
		console.log('\x1b[32mLabel successfully added!\x1b[0m');
	} catch(error) {
		console.error(error);
	}
}

async function addComment(cardShortLink,text) {
	try {
		const card=await apiRequest('GET',`/cards/${cardShortLink}`);
		console.log(`Adding comment to card [${cardShortLink}]...`);
		await apiRequest('POST',`/cards/${card.id}/actions/comments`,{text:text});
		console.log('\x1b[32mComment successfully added!\x1b[0m');
	} catch(error) {
		console.error(error);
	}
}

async function addCheckItem(cardShortLink,itemName) {
	try {
		const card=await apiRequest('GET',`/cards/${cardShortLink}`);
		const checklists=await apiRequest('GET',`/cards/${card.id}/checklists`);
		let checklist=checklists[0];
		if(!checklist) {
			console.log('Creating new checklist "Tasks"...');
			checklist=await apiRequest('POST',`/cards/${card.id}/checklists`,{name:'Tasks'});
		}
		console.log(`Adding "${itemName}" to checklist "${checklist.name}"...`);
		await apiRequest('POST',`/checklists/${checklist.id}/checkItems`,{name:itemName});
		console.log('\x1b[32mChecklist item successfully added!\x1b[0m');
		
		// Sync local active_ticket.json
		const updatedChecklists=await apiRequest('GET',`/cards/${card.id}/checklists`);
		await syncLocalActiveTicket(card,updatedChecklists);
	} catch(error) {
		console.error(error);
	}
}

async function completeCheckItem(cardShortLink,itemName) {
	try {
		const card=await apiRequest('GET',`/cards/${cardShortLink}`);
		const checklists=await apiRequest('GET',`/cards/${card.id}/checklists`);
		let foundItem=null;
		for(const cl of checklists) {
			const item=cl.checkItems.find(i=>i.name.toLowerCase().includes(itemName.toLowerCase()));
			if(item) {
				foundItem={checklistId:cl.id,item:item};
				break;
			}
		}
		if(!foundItem) throw `Checklist item "${itemName}" not found!`;
		console.log(`Marking "${foundItem.item.name}" as completed...`);
		await apiRequest('PUT',`/cards/${card.id}/checkItem/${foundItem.item.id}`,{state:'complete'});
		console.log('\x1b[32mChecklist item marked as completed!\x1b[0m');
		
		// Sync local active_ticket.json
		const updatedChecklists=await apiRequest('GET',`/cards/${card.id}/checklists`);
		await syncLocalActiveTicket(card,updatedChecklists);
	} catch(error) {
		console.error(error);
	}
}

async function searchCards(query) {
	try {
		console.log(`Searching for "${query}" on the board...`);
		const lists=await apiRequest('GET',`/boards/${boardId}/lists`);
		const cards=await apiRequest('GET',`/boards/${boardId}/cards`);
		const matches=cards.filter(c=>c.name.toLowerCase().includes(query.toLowerCase())||(c.desc&&c.desc.toLowerCase().includes(query.toLowerCase())));
		if(matches.length===0) {
			console.log('No matching cards found.');
			return;
		}
		matches.forEach(card=>{
			const list=lists.find(l=>l.id===card.idList);
			console.log(`\n\x1b[36m- [${card.shortLink}] ${card.name}\x1b[0m`);
			console.log(`  List: ${list?list.name:'Unknown'}`);
			if(card.desc) console.log(`  Description: ${card.desc.substring(0,100)}...`);
		});
	} catch(error) {
		console.error(error);
	}
}

function getCardWeight(card) {
	let minWeight=priorityOrder.length+1;
	if(card.labels) {
		for(const label of card.labels) {
			const index=priorityOrder.indexOf(label.name);
			if(index!==-1) {
				minWeight=Math.min(minWeight,index+1);
			}
		}
	}
	return minWeight;
}

async function sortBoard() {
	try {
		console.log('Retrieving lists from Trello board...');
		const lists=await apiRequest('GET',`/boards/${boardId}/lists`);
		
		for(const list of lists) {
			console.log(`\nChecking list: "${list.name}"...`);
			const cards=await apiRequest('GET',`/lists/${list.id}/cards`);
			if(cards.length<=1) {
				console.log('  Too few cards to sort.');
				continue;
			}
			
			const sortedCards=[...cards].sort((a,b)=>{
				const wA=getCardWeight(a);
				const wB=getCardWeight(b);
				if(wA!==wB) return wA-wB;
				return a.pos-b.pos;
			});
			
			let isSorted=true;
			for(let i=0;i<cards.length;i++) {
				if(cards[i].id!==sortedCards[i].id) {
					isSorted=false;
					break;
				}
			}
			
			if(isSorted) {
				console.log('  List is already correctly sorted.');
				continue;
			}
			
			console.log(`  Sorting ${sortedCards.length} cards in the list...`);
			for(let i=0;i<sortedCards.length;i++) {
				const card=sortedCards[i];
				const newPos=i+1;
				console.log(`    Moving card [${card.shortLink}] "${card.name}" to position ${newPos}...`);
				await apiRequest('PUT',`/cards/${card.id}`,{pos:newPos});
			}
			console.log(`  List "${list.name}" successfully sorted.`);
		}
		console.log('\n\x1b[32mAll lists successfully sorted!\x1b[0m');
	} catch(error) {
		console.error('Error sorting the board:',error);
	}
}

async function backupBoard() {
	try {
		console.log('Creating backup of Trello board...');
		const lists=await apiRequest('GET',`/boards/${boardId}/lists`);
		let output=`Trello Board Backup - ${new Date().toLocaleString('en-US')}\n`;
		output+=`===============================================\n`;
		
		for(const list of lists) {
			output+=`\n=== List: ${list.name} (ID: ${list.id}) ===\n`;
			const cards=await apiRequest('GET',`/lists/${list.id}/cards`);
			if(cards.length===0) {
				output+='  (No tasks)\n';
			} else {
				cards.forEach(card=>{
					output+=`  - [${card.shortLink}] ${card.name}\n`;
					if(card.desc) {
						output+=`    Description: ${card.desc.replace(/\\r?\\n/g,'\\n    ')}\n`;
					}
				});
			}
		}
		
		let backupFilePath=path.join(process.cwd(),'.agents','board_backup.txt');
		if(!fs.existsSync(path.dirname(backupFilePath))) {
			backupFilePath=path.join(__dirname,'board_backup.txt');
		}
		
		fs.writeFileSync(backupFilePath,output,'utf8');
		console.log(`\x1b[32mBackup successfully saved to ${backupFilePath}!\x1b[0m`);
	} catch(error) {
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

function cleanEmailBody(body) {
	if(!body) return '';
	const lines=body.split(/\r?\n/);
	const cleanedLines=[];
	const cutSignatures=[
		/^\s*[-_—=]{3,}\s*$/,
		/^\s*am\s+\d{1,2}\.\d{1,2}\.\d{4}\s+/i,
		/^\s*on\s+.*wrote\s*:\s*$/i,
		/^\s*von\s*:\s*/i,
		/^\s*from\s*:\s*/i,
		/^\s*sent\s+from\s+my\s+/i,
		/^\s*gesendet\s+mit\s+/i,
		/^\s*original\s+message/i,
		/^\s*ursprüngliche\s+nachricht/i,
		/^\s*--\s*$/,
		/^\s*(mit\s+freundlichen\s+grüßen|viele\s+grüße|liebe\s+grüße|kind\s+regards|best\s+regards|regards|sincerely)\s*,?\s*$/i,
		/^\s*(gesendet\s+von|gesendet\s+aus)\s+/i
	];
	for(const line of lines) {
		if(cutSignatures.some(regex=>regex.test(line))) {
			break;
		}
		cleanedLines.push(line);
	}
	return cleanedLines.join('\n').trim();
}

function getNormalizedTitle(title) {
	let clean=title.trim();
	let changed=true;
	while(changed) {
		changed=false;
		const emailPrefixRegex=/^(re|fwd|aw|wg|antwort|fw)\s*:\s*/i;
		if(emailPrefixRegex.test(clean)) {
			clean=clean.replace(emailPrefixRegex,'').trim();
			changed=true;
		}
		for(const mapping of labelMappings) {
			const keyword=mapping.prefix.replace(/[\[\]]/g,'').trim().toLowerCase();
			const patterns=[
				`[${keyword}]`,
				`${keyword}:`,
				`[${keyword}]:`
			];
			for(const pat of patterns) {
				if(clean.toLowerCase().startsWith(pat.toLowerCase())) {
					clean=clean.substring(pat.length).trim();
					changed=true;
				}
			}
		}
	}
	return clean.replace(/\s+/g,' ').toLowerCase();
}

async function searchAndMerge(incomingCard,allCards,inboxList,lists) {
	const incomingNormalized=getNormalizedTitle(incomingCard.name);
	if(incomingNormalized.length<5) {
		return false;
	}
	const matchedCard=allCards.find(c=>c.id!==incomingCard.id&&getNormalizedTitle(c.name)===incomingNormalized);
	if(matchedCard) {
		console.log(`  -> Match found! Merging [${incomingCard.shortLink}] into existing card [${matchedCard.shortLink}] ("${matchedCard.name}")`);
		let sender='';
		try {
			const attachments=await apiRequest('GET',`/cards/${incomingCard.id}/attachments`);
			const emlAttachment=attachments&&attachments.find(att=>att.name&&att.name.toLowerCase().endsWith('.eml'));
			if(emlAttachment) {
				const emlContent=await getEmlContent(incomingCard.id,emlAttachment.id,emlAttachment.name);
				const fromMatch=emlContent.match(/^From:\s*([^\r\n]+)/mi);
				if(fromMatch) {
					sender=fromMatch[1].trim();
				}
			}
		}
		catch(err) {
			console.error(`  -> Failed to extract sender for merge:`,err.message||err);
		}
		const cleanedDesc=cleanEmailBody(incomingCard.desc);
		const senderHeader=sender?` from **${sender}**` : '';
		const senderInfo=cleanedDesc?`\n\n**${MSG_EMAIL_CONTENT}:**\n${cleanedDesc}`:`\n*(${MSG_NO_EMAIL_CONTENT})*`;
		const commentText=`${MSG_EMAIL_UPDATE}${senderHeader}\n"${incomingCard.name}"${senderInfo}`;
		await apiRequest('POST',`/cards/${matchedCard.id}/actions/comments`,{text:commentText});
		try {
			const attachments=await apiRequest('GET',`/cards/${incomingCard.id}/attachments`);
			if(attachments&&attachments.length>0) {
				console.log(`  -> Transferring ${attachments.length} attachment(s)...`);
				for(const att of attachments) {
					await apiRequest('POST',`/cards/${matchedCard.id}/attachments`,{url:att.url,name:att.name});
				}
				await embedMissingImages(matchedCard);
			}
		}
		catch(err) {
			console.error(`  -> Error transferring attachments:`,err.message||err);
		}
		
		const completedList=lists.find(l=>l.name.toLowerCase().includes(COMPLETED_LIST_NAME.toLowerCase()));
		if(matchedCard.closed||(completedList&&matchedCard.idList===completedList.id)) {
			console.log(`  -> Original card was completed/archived. Reopening and moving to Inbox...`);
			await apiRequest('PUT',`/cards/${matchedCard.id}`,{idList:inboxList.id,closed:false});
			await apiRequest('POST',`/cards/${matchedCard.id}/actions/comments`,{text:MSG_TICKET_REOPENED});
		}
		
		console.log(`  -> Deleting temporary inbox card [${incomingCard.shortLink}]...`);
		await apiRequest('DELETE',`/cards/${incomingCard.id}`);
		return true;
	}
	return false;
}

async function processInbox() {
	try {
		console.log(`Retrieving lists to find inbox "${INBOX_LIST_NAME}"...`);
		const lists=await apiRequest('GET',`/boards/${boardId}/lists`);
		const inboxList=lists.find(l=>l.name.toLowerCase().includes(INBOX_LIST_NAME.toLowerCase()));
		if(!inboxList) {
			console.error(`Error: Inbox list "${INBOX_LIST_NAME}" not found.`);
			return;
		}
		
		const allCards=await apiRequest('GET',`/boards/${boardId}/cards?filter=all`);
		const completedList=lists.find(l=>l.name.toLowerCase().includes(COMPLETED_LIST_NAME.toLowerCase()));
		
		// Clean and process recent comment actions on the board (e.g. to handle email-to-card comments & reopens)
		console.log('Checking recent board comments for email signatures or reopening triggers...');
		try {
			const cardActionsCache={};
			const recentActions=await apiRequest('GET',`/boards/${boardId}/actions?filter=commentCard&limit=25`);
			for(const action of recentActions) {
				const text=action.data.text;
				if(!text) continue;
				
				// 1. Check if comment needs signature cleaning
				const cleaned=cleanEmailBody(text);
				if(cleaned!==text) {
					console.log(`  -> Found uncleaned comment [${action.id}] on card "${action.data.card.name}". Cleaning...`);
					try {
						await apiRequest('PUT',`/actions/${action.id}`,{text:cleaned});
						action.data.text=cleaned;
					} catch(err) {
						console.error(`  -> Failed to clean comment [${action.id}]:`,err.message||err);
					}
				}
				
				// 2. Check if the card is in Completed Tickets or archived and this comment is a new user comment
				const cardId=action.data.card.id;
				const card=allCards.find(c=>c.id===cardId);
				if(card) {
					if(card.closed||(completedList&&card.idList===completedList.id)) {
						const isSystemComment=cleaned.includes("Ticket automatically reopened") || 
						                      cleaned.includes("Processing completed") || 
						                      cleaned.includes("Processing started") ||
						                      cleaned.includes("Email update received");
						
						if(!isSystemComment) {
							let shouldReopen=true;
							try {
								let cardActions;
								if(cardActionsCache[card.id]) {
									cardActions=cardActionsCache[card.id];
								} else {
									cardActions=await apiRequest('GET',`/cards/${card.id}/actions?filter=updateCard&limit=15`);
									cardActionsCache[card.id]=cardActions;
								}
								const moveAction=cardActions.find(a=>{
									if(a.type==='updateCard') {
										if(a.data&&a.data.listAfter&&a.data.listAfter.id===completedList.id) {
											return true;
										}
										if(a.data&&a.data.old&&a.data.old.hasOwnProperty('closed')&&a.data.card&&a.data.card.closed===true) {
											return true;
										}
									}
									return false;
								});
								if(moveAction) {
									const commentTime=new Date(action.date).getTime();
									const moveTime=new Date(moveAction.date).getTime();
									if(commentTime<=moveTime) {
										shouldReopen=false;
									}
								}
							} catch(actionErr) {
								console.error(`  -> Failed to check card update actions for [${card.shortLink}]:`,actionErr.message||actionErr);
							}
							
							if(shouldReopen) {
								console.log(`  -> New user comment detected on completed/archived card [${card.shortLink}] (comment time is newer than list move time). Reopening and moving to Inbox...`);
								await apiRequest('PUT',`/cards/${card.id}`,{idList:inboxList.id,closed:false});
								await apiRequest('POST',`/cards/${card.id}/actions/comments`,{text:MSG_TICKET_REOPENED});
								card.idList=inboxList.id;
								card.closed=false;
							} else {
								console.log(`  -> Skipping reopen for [${card.shortLink}]: Comment was created before the card was moved to Completed/Archived.`);
							}
						}
					}
				}
			}
		} catch(actionErr) {
			console.error('Error processing board comments:',actionErr.message||actionErr);
		}
		
		console.log(`Fetching cards from inbox list "${inboxList.name}"...`);
		const cards=await apiRequest('GET',`/lists/${inboxList.id}/cards`);
		
		if(cards.length===0) {
			console.log('No new email tickets in the inbox.');
			console.log('\x1b[32mInbox processing completed successfully!\x1b[0m');
			return;
		}
		
		console.log(`Found ${cards.length} ticket(s) in the inbox. Processing...`);
		
		for(const card of cards) {
			console.log(`\nProcessing ticket: "${card.name}" [${card.shortLink}]`);
			
			const merged=await searchAndMerge(card,allCards,inboxList,lists);
			if(merged) {
				continue;
			}
			
			// Embed images
			await embedMissingImages(card);
			
			// Process EML attachment to extract sender and clean description
			try {
				const attachments=await apiRequest('GET',`/cards/${card.id}/attachments`);
				const emlAttachment=attachments&&attachments.find(att=>att.name&&att.name.toLowerCase().endsWith('.eml'));
				if(emlAttachment) {
					if(card.desc&&card.desc.includes('Ticket erstellt von:')) {
						console.log('  -> Card already processed. Skipping.');
					}else {
						console.log(`  -> Found email attachment: "${emlAttachment.name}". Extracting sender...`);
						const emlContent=await getEmlContent(card.id,emlAttachment.id,emlAttachment.name);
						const fromMatch=emlContent.match(/^From:\s*([^\r\n]+)/mi);
						if(fromMatch) {
							const sender=fromMatch[1].trim();
							console.log(`  -> Extracted sender: ${sender}`);
							const cleanedDesc=cleanEmailBody(card.desc);
							const newDesc=`**Ticket erstellt von:** ${sender}\n\n---\n\n${cleanedDesc}`;
							await apiRequest('PUT',`/cards/${card.id}`,{desc:newDesc});
							card.desc=newDesc;
							console.log(`  -> Description updated with sender info and signature removed.`);
						}
					}
				}
			}
			catch(err) {
				console.error(`  -> Failed to process EML attachment:`,err.message||err);
			}
			
			const { cleanTitle, matchedLabel } = parsePrefixAndCleanTitle(card.name);
			
			// 1. Update title if changed (prefix removed)
			if (cleanTitle !== card.name) {
				console.log(`  -> Changing title to: "${cleanTitle}"`);
				await apiRequest('PUT',`/cards/${card.id}`,{name:cleanTitle});
			}
			
			// 2. Assign label if matched
			if (matchedLabel) {
				const hasLabel = card.labels && card.labels.some(l => l.name === matchedLabel.name);
				if (!hasLabel) {
					console.log(`  -> Assigning label "${matchedLabel.name}" (${matchedLabel.color})...`);
					await apiRequest('POST',`/cards/${card.id}/labels?color=${matchedLabel.color}&name=${encodeURIComponent(matchedLabel.name)}`);
				}
			}
		}
		
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

async function listenInbox(intervalMinutes=0.1667) {
	console.log(`\n\x1b[35m=== Trello Inbox Polling Daemon Started ===\x1b[0m`);
	console.log(`Monitoring list: "${INBOX_LIST_NAME}"`);
	const seconds=Math.round(intervalMinutes*60);
	console.log(`Interval: every ${seconds} seconds`);
	console.log(`Press Ctrl+C to terminate.\n`);
	
	// First run immediately
	await processInbox();
	
	setInterval(async ()=>{
		const timestamp=new Date().toLocaleString('de-DE');
		console.log(`\n[${timestamp}] Checking inbox...`);
		await processInbox();
	},intervalMinutes*60000);
}

async function completeSession(cardShortLink,manualTimeEstimate='') {
	try {
		// 1. Fetch and move the Trello card
		const card=await apiRequest('GET',`/cards/${cardShortLink}`);
		const lists=await apiRequest('GET',`/boards/${boardId}/lists`);
		const targetList=lists.find(l=>l.name.toLowerCase().includes(COMPLETED_LIST_NAME.toLowerCase()))||
		                 lists.find(l=>l.name.toLowerCase().includes('implemented')||l.name.toLowerCase().includes('done')||l.name.toLowerCase().includes('completed')||l.name.toLowerCase().includes('complete'));
		if(!targetList) throw `No matching list ("${COMPLETED_LIST_NAME}", "Implemented", "Completed", or "Done") found!`;
		
		console.log(`Moving card [${cardShortLink}] "${card.name}" to list "${targetList.name}"...`);
		await apiRequest('PUT',`/cards/${card.id}?idList=${targetList.id}&pos=top`);
		
		// Delete local active_ticket.json if present
		const activeTicketPath=path.join(process.cwd(),'active_ticket.json');
		if(fs.existsSync(activeTicketPath)) {
			try {
				fs.unlinkSync(activeTicketPath);
				console.log('Local active_ticket.json deleted.');
			} catch(e) {
				// Ignore
			}
		}
		
		// 2. Read billing log (try local project folder first, fallback to script directory)
		const logFilename=config.BILLING_LOG_FILE||'billing-log.md';
		let billingLogPath;
		if(path.isAbsolute(logFilename)) {
			billingLogPath=logFilename;
		} else {
			billingLogPath=path.join(process.cwd(),'.agents','billing',logFilename);
			if(!fs.existsSync(billingLogPath)) {
				billingLogPath=path.join(__dirname,'..','billing',logFilename);
			}
		}
		
		if(!fs.existsSync(billingLogPath)) {
			console.log('Notice: billing log file does not exist, skipping automatic log entry.');
			return;
		}
		
		let content=fs.readFileSync(billingLogPath,'utf8');
		
		// Find the active session line in the logbook
		const lines=content.split(/\r?\n/);
		let activeLineIndex=-1;
		let startTimeStr='';
		let dateStr='';
		
		for(let i=0;i<lines.length;i++) {
			if(lines[i].includes('*Aktiv*')||lines[i].includes('In Arbeit')) {
				activeLineIndex=i;
				const cols=lines[i].split('|').map(c=>c.trim());
				if(cols.length>=7) {
					dateStr=cols[1];
					startTimeStr=cols[2];
				}
				break;
			}
		}
		
		if(activeLineIndex===-1) {
			console.log('No active session found in the logbook. Card moved, log untouched.');
			return;
		}
		
		// 3. Calculate session duration
		const now=new Date();
		const pad=n=>String(n).padStart(2,'0');
		const endTimeStr=`${pad(now.getHours())}:${pad(now.getMinutes())}`;
		
		const [startH,startM]=startTimeStr.split(':').map(Number);
		const start=new Date(now);
		start.setHours(startH,startM,0,0);
		let diffMs=now-start;
		if(diffMs<0) diffMs+=24*60*60*1000;
		const durationMin=Math.round(diffMs/60000);
		
		let estHours=Math.ceil((durationMin*7.5)/10)*10;
		if(estHours<30) estHours=45;
		const actualTimeText=`${durationMin} Min.`;
		
		let estTimeText=manualTimeEstimate;
		if(!estTimeText) {
			if(estHours>=60) {
				estTimeText=`${Math.floor(estHours/60)} Std. ${estHours%60?(estHours%60)+' Min.':''}`;
			} else {
				estTimeText=`${estHours} Min.`;
			}
		}
		
		// Update the session line in the logbook
		lines[activeLineIndex]=`| ${dateStr} | ${startTimeStr} | ${endTimeStr} | ${actualTimeText} | ${estTimeText} | Erledigt (${card.name}) |`;
		
		// 4. Post completion comment on Trello
		const nowFormatted=now.toLocaleString('de-DE');
		const completionComment=MSG_PROCESSING_COMPLETED
			.replace('{timestamp}',nowFormatted)
			.replace('{actual_duration}',actualTimeText)
			.replace('{estimated_duration}',estTimeText)
			.replace('{duration}',estTimeText);
		console.log(`Adding Trello comment: "${completionComment}"`);
		try {
			await apiRequest('POST',`/cards/${card.id}/actions/comments`,{text:completionComment});
		} catch(commentErr) {
			console.error('Error posting completion comment:',commentErr.message||commentErr);
		}
        
        // 5. Generate billing item entry
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

async function showNewTickets() {
	try {
		console.log('Checking for new tickets across all registered boards...');
		if(!fs.existsSync(projectsPath)) {
			console.error('projects.json not found!');
			return;
		}
		const projects=JSON.parse(fs.readFileSync(projectsPath,'utf8'));
		const boards=projects.TRELLO_BOARDS||{};
		let hasUpdated=false;
		const nowStr=new Date().toISOString();
		const isPeek=args[1]==='peek';

		for(const boardUrl of Object.keys(boards)) {
			const boardConfig=boards[boardUrl];
			const key=boardConfig.TRELLO_KEY||projects.TRELLO_KEY;
			const token=boardConfig.TRELLO_TOKEN||projects.TRELLO_TOKEN;
			if(!key||!token) continue;

			let bId=boardUrl;
			if(boardUrl.includes('/b/')) {
				const match=boardUrl.match(/\/b\/([^\/]+)/);
				if(match) bId=match[1];
			}

			const inboxName=boardConfig.TRELLO_LIST_INCOMING||'Incoming Tickets';
			
			const boardApiRequest=(method,urlPath,payload=null)=>{
				return new Promise((resolve,reject)=>{
					const querySymbol=urlPath.includes('?')?'&':'?';
					const fullPath=`/1${urlPath}${querySymbol}key=${key}&token=${token}`;
					const options={
						hostname:'api.trello.com',
						port:443,
						path:fullPath,
						method:method,
						headers:{'Content-Type':'application/json'}
					};
					const req=https.request(options,res=>{
						let data='';
						res.on('data',chunk=>data+=chunk);
						res.on('end',()=>{
							if(res.statusCode>=200&&res.statusCode<300) {
								try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
							} else { reject(`Error (${res.statusCode}): ${data}`); }
						});
					});
					req.on('error',e=>reject(e));
					if(payload) req.write(JSON.stringify(payload));
					req.end();
				});
			};

			const lists=await boardApiRequest('GET',`/boards/${bId}/lists`);
			const inboxList=lists.find(l=>l.name.toLowerCase().includes(inboxName.toLowerCase()));
			if(!inboxList) {
				console.log(`\nBoard: ${boardUrl}\n  List "${inboxName}" not found.`);
				continue;
			}

			const cards=await boardApiRequest('GET',`/lists/${inboxList.id}/cards`);
			const lastChecked=boardConfig.LAST_CHECKED;
			const newCards=[];

			for(const card of cards) {
				const cardTime=parseInt(card.id.substring(0,8),16)*1000;
				if(!lastChecked||cardTime>new Date(lastChecked).getTime()) {
					newCards.push(card);
				}
			}

			console.log(`\nBoard: ${boardUrl}`);
			if(newCards.length===0) {
				console.log('  No new tickets.');
			} else {
				console.log(`  \x1b[36m${newCards.length} new ticket(s) found:\x1b[0m`);
				newCards.forEach(card=>{
					console.log(`  \x1b[34m🔵\x1b[0m [${card.shortLink}] ${card.name}`);
				});
				boardConfig.LAST_CHECKED=nowStr;
				hasUpdated=true;
			}
		}

		if(hasUpdated&&!isPeek) {
			fs.writeFileSync(projectsPath,JSON.stringify(projects,null,'\t').replace(/": /g,'":')+'\n','utf8');
			console.log('\nLAST_CHECKED timestamps updated in projects.json.');
		} else if(hasUpdated&&isPeek) {
			console.log('\nPeek mode: LAST_CHECKED timestamps were not updated.');
		}
	} catch(error) {
		console.error('Error checking new tickets:',error);
	}
}

function showStatus() {
	console.log('\x1b[35m==================================================\x1b[0m');
	console.log('\x1b[35m⚡ TRELLO CONTROLLER - SYSTEM DAEMON STATUS ⚡\x1b[0m');
	console.log('\x1b[35m==================================================\x1b[0m');
	
	let runningPid=null;
	try {
		const procOutput=execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"CommandLine like '%global_runner.js%'\\" | Select-Object -Property ProcessId, CommandLine | ConvertTo-Json"`,{encoding:'utf8'});
		if(procOutput.trim()) {
			const data=JSON.parse(procOutput);
			const procList=Array.isArray(data)?data:[data];
			const runnerProc=procList.find(p=>p.CommandLine&&p.CommandLine.includes('node')&&p.CommandLine.includes('global_runner.js'));
			if(runnerProc) {
				runningPid=runnerProc.ProcessId;
				console.log(`\x1b[36mDaemon Process:\x1b[0m  \x1b[32mACTIVE (PID: ${runningPid})\x1b[0m`);
				console.log(`\x1b[36mCommand Line:\x1b[0m    ${runnerProc.CommandLine}`);
			}
		}
	} catch(e) {}
	if(!runningPid) {
		console.log(`\x1b[36mDaemon Process:\x1b[0m  \x1b[31mINACTIVE / STOPPED\x1b[0m`);
	}
	
	try {
		const taskOutput=execSync(`powershell -NoProfile -Command "Get-ScheduledTask -TaskName 'TrelloInboxProcessor' | Get-ScheduledTaskInfo | ConvertTo-Json"`,{encoding:'utf8'});
		if(taskOutput.trim()) {
			const info=JSON.parse(taskOutput);
			const stateOutput=execSync(`powershell -NoProfile -Command "(Get-ScheduledTask -TaskName 'TrelloInboxProcessor').State"`,{encoding:'utf8'}).trim();
			
			console.log(`\x1b[36mScheduled Task:\x1b[0m  \x1b[36m${info.TaskName}\x1b[0m`);
			console.log(`\x1b[36mTask State:\x1b[0m      ${stateOutput==='Ready'?'\x1b[32mReady\x1b[0m':`\x1b[33m${stateOutput}\x1b[0m`}`);
			
			const parseDate=jsonDateStr=>{
				if(!jsonDateStr) return 'N/A';
				const match=jsonDateStr.match(/\/Date\((\d+)\)\//);
				if(match) return new Date(parseInt(match[1])).toLocaleString('de-DE');
				return jsonDateStr;
			};
			
			console.log(`\x1b[36mLast Run Time:\x1b[0m   ${parseDate(info.LastRunTime)}`);
			console.log(`\x1b[36mNext Run Time:\x1b[0m   ${parseDate(info.NextRunTime)}`);
			console.log(`\x1b[36mLast Result:\x1b[0m      ${info.LastTaskResult===0?'\x1b[32mSuccess (0)\x1b[0m':`\x1b[31mError (${info.LastTaskResult})\x1b[0m`}`);
		}
	} catch(e) {
		console.log(`\x1b[36mScheduled Task:\x1b[0m  \x1b[31mNot Configured or Accessible\x1b[0m`);
	}
	console.log('\x1b[35m==================================================\x1b[0m\n');
}

function showProjects() {
	console.log('\x1b[35m==================================================\x1b[0m');
	console.log('\x1b[35m⚡ TRELLO CONTROLLER - REGISTERED PROJECTS ⚡\x1b[0m');
	console.log('\x1b[35m==================================================\x1b[0m');
	
	if(!fs.existsSync(projectsPath)) {
		console.error('Error: projects.json not found!');
		return;
	}
	
	const projects=JSON.parse(fs.readFileSync(projectsPath,'utf8'));
	const boards=projects.TRELLO_BOARDS||{};
	
	for(const boardUrl of Object.keys(boards)) {
		console.log(`\n\x1b[36mBoard: ${boardUrl}\x1b[0m`);
		const boardConfig=boards[boardUrl];
		
		const localProjects=boardConfig.LOCAL_PROJECTS||[];
		if(localProjects.length===0) {
			console.log('  (No local projects registered)');
		} else {
			for(const p of localProjects) {
				const folderExists=fs.existsSync(p.folder_path);
				let symlinkStatus='\x1b[31mMissing .agents Symlink\x1b[0m';
				if(folderExists) {
					const symlinkPath=path.join(p.folder_path,'.agents');
					if(fs.existsSync(symlinkPath)) {
						try {
							const stats=fs.lstatSync(symlinkPath);
							if(stats.isSymbolicLink()) {
								symlinkStatus='\x1b[32mSymlink OK\x1b[0m';
							} else {
								symlinkStatus='\x1b[33mFolder (Not Symlink)\x1b[0m';
							}
						} catch(e) {
							symlinkStatus='\x1b[32mSymlink OK\x1b[0m';
						}
					}
				}
				
				console.log(`  - \x1b[1m${p.name}\x1b[0m`);
				console.log(`    Path:    ${p.folder_path} (${folderExists?'\x1b[32mExists\x1b[0m':'\x1b[31mNot Found\x1b[0m'})`);
				console.log(`    Log:     ${p.billing_path} (${fs.existsSync(p.billing_path)?'\x1b[32mExists\x1b[0m':'\x1b[31mNot Found\x1b[0m'})`);
				console.log(`    Status:  ${symlinkStatus}`);
			}
		}
	}
	console.log('\n\x1b[35m==================================================\x1b[0m\n');
}

// CLI Command Parser

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
    const interval = parseFloat(args[1]) || 0.1667;
    listenInbox(interval);
}
else if(command === 'news' || command === 'unread') {
	showNewTickets();
}
else if(command === 'status') {
	showStatus();
}
else if(command === 'projects') {
	showProjects();
}
else {
	console.log('Unknown command. Available: list, add, move, start, archive, delete, label, comment, check, check-done, search, complete, backup, sort, inbox, listen, sync, news, status, projects');
}
