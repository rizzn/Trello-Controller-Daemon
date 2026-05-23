const fs = require('fs');
const path = require('path');
const https = require('https');

// 1. config.env aus dem lokalen Projekt-Verzeichnis einlesen
// 1. Konfiguration aus der zentralen projects.json laden
const projectsPath=path.join(__dirname,'projects.json');
let config={};

if(fs.existsSync(projectsPath)) {
	try {
		const projects=JSON.parse(fs.readFileSync(projectsPath,'utf8'));
		const currentPath=process.cwd().replace(/\\/g,'/').toLowerCase();
		
		// Finde den passenden Eintrag (Case-insensitive Pfad-Vergleich)
		const matchedKey=Object.keys(projects).find(k=>k.replace(/\\/g,'/').toLowerCase()===currentPath);
		if(matchedKey) {
			config=projects[matchedKey];
		}
	}
	catch(e) {
		console.error('Fehler beim Lesen der zentralen projects.json:',e.message);
	}
}

const KEY=config.TRELLO_KEY;
const TOKEN=config.TRELLO_TOKEN;
let BOARD_URL=config.TRELLO_BOARD_URL;

if(!KEY||!TOKEN||!BOARD_URL) {
	console.error('Fehler: Dieses Projektverzeichnis ist nicht in E:\\.appdata\\.agents\\trello\\projects.json registriert oder es fehlen Konfigurationen.');
	console.error(`Aktuelles Verzeichnis: ${process.cwd()}`);
	process.exit(1);
}

// Priority Order und Label Mappings aus globaler controller.json laden
const globalConfigPath=path.join(__dirname,'controller.json');
let globalConfig={};
if(fs.existsSync(globalConfigPath)) {
	try {
		globalConfig=JSON.parse(fs.readFileSync(globalConfigPath,'utf8'));
	}
	catch(e) {
		console.error('Fehler beim Lesen der globalen controller.json:',e.message);
	}
}

const priorityOrder=globalConfig.priorityOrder||['Important','Bug','Feature','UI/UX','Refactor','Controlling'];
const labelMappings=globalConfig.labelMappings||[];
const INBOX_LIST_NAME=config.TRELLO_INBOX_LIST||globalConfig.defaultInboxListName||'Incoming Tickets';
const ACTIVE_LIST_NAME=config.TRELLO_ACTIVE_LIST||'Active Tickets';
const COMPLETED_LIST_NAME=config.TRELLO_COMPLETED_LIST||'Completed Tickets';

// Board-ID aus der URL extrahieren falls nötig
let boardId = BOARD_URL;
if(BOARD_URL.includes('/b/')) {
    const match = BOARD_URL.match(/\/b\/([^\/]+)/);
    if(match) boardId = match[1];
}

// Helper für HTTPS Requests
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
                    reject(`Trello-API Fehler (${res.statusCode}): ${data}`);
                }
            });
        });

        req.on('error', (e) => reject(e));
        if(payload) req.write(JSON.stringify(payload));
        req.end();
    });
}

// Hauptfunktionen
async function showBoard() {
    try {
        console.log('Rufe Trello-Board ab...');
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        
        for (const list of lists) {
            console.log(`\n\x1b[36m=== List: ${list.name} (ID: ${list.id}) ===\x1b[0m`);
            const cards = await apiRequest('GET', `/lists/${list.id}/cards`);
            if(cards.length === 0) {
                console.log('  (Keine Aufgaben)');
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
        if(lists.length === 0) throw 'Keine Listen auf dem Board gefunden!';
        
        let targetList = lists[0];
        if(listName) {
            const found = lists.find(l => l.name.toLowerCase().includes(listName.toLowerCase()));
            if(found) targetList = found;
        }
        
        const parsed = parsePrefixAndCleanTitle(title);
        const cleanTitle = parsed.cleanTitle;
        const matchedLabel = parsed.matchedLabel;

        console.log(`Erstelle Karte in Liste "${targetList.name}"...`);
        const newCard = await apiRequest('POST', `/cards?idList=${targetList.id}`, {
            name: cleanTitle,
            desc: desc,
            pos: 'top'
        });
        console.log(`\x1b[32mKarte erfolgreich erstellt! ID: [${newCard.shortLink}]\x1b[0m`);
        
        if (matchedLabel) {
            console.log(`Füge Label "${matchedLabel.name}" (${matchedLabel.color}) hinzu...`);
            await apiRequest('POST', `/cards/${newCard.id}/labels?color=${matchedLabel.color}&name=${encodeURIComponent(matchedLabel.name)}`);
            console.log('\x1b[32mLabel erfolgreich hinzugefügt!\x1b[0m');
        }
        
        // await sortBoard(); // Automatische Sortierung deaktiviert
    } catch (error) {
        console.error(error);
    }
}

async function moveCard(cardShortLink, targetListName) {
    try {
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        const targetList = lists.find(l => l.name.toLowerCase().includes(targetListName.toLowerCase()));
        if(!targetList) throw `Liste "${targetListName}" nicht gefunden!`;
        
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        
        console.log(`Bewege Karte [${cardShortLink}] "${card.name}" in die Liste "${targetList.name}"...`);
        await apiRequest('PUT', `/cards/${card.id}?idList=${targetList.id}`);
        console.log('\x1b[32mKarte erfolgreich verschoben!\x1b[0m');
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
				console.log('Lokales active_ticket.json aktualisiert.');
			}
		}
		catch(e) {
			// Ignorieren
		}
	}
}

async function startCard(cardShortLink) {
    try {
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        const targetList = lists.find(l => l.name.toLowerCase().includes(ACTIVE_LIST_NAME.toLowerCase()));
        if(!targetList) throw `Liste "${ACTIVE_LIST_NAME}" nicht gefunden!`;
        
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        
        // Bilder-Anhänge in Beschreibung einbetten falls vorhanden
        await embedMissingImages(card);
        
        console.log(`Bewege Karte [${cardShortLink}] "${card.name}" in die Liste "${targetList.name}"...`);
        await apiRequest('PUT', `/cards/${card.id}?idList=${targetList.id}`);
        
        const timestamp = new Date().toLocaleString('de-DE');
        const commentText = `Bearbeitung gestartet am ${timestamp}`;
        console.log(`Füge Kommentar hinzu: "${commentText}"`);
        await apiRequest('POST', `/cards/${card.id}/actions/comments`, { text: commentText });
        
        console.log('\x1b[32mKarte erfolgreich gestartet!\x1b[0m');
        
        // active_ticket.json erstellen für KI-Assistenten-Kontext
        console.log('Rufe Checklisten für das Ticket ab...');
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
        console.log('\x1b[32mactive_ticket.json erfolgreich im Workspace erstellt!\x1b[0m');
        
        // await sortBoard(); // Automatische Sortierung deaktiviert
    } catch (error) {
        console.error(error);
    }
}

async function archiveCard(cardShortLink) {
    try {
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        console.log(`Archiviere Karte [${cardShortLink}] "${card.name}"...`);
        await apiRequest('PUT', `/cards/${card.id}?closed=true`);
        console.log('\x1b[32mKarte erfolgreich archiviert!\x1b[0m');
    } catch (error) {
        console.error(error);
    }
}

async function deleteCard(cardShortLink) {
    try {
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        console.log(`Lösche Karte [${cardShortLink}] "${card.name}" endgültig...`);
        await apiRequest('DELETE', `/cards/${card.id}`);
        console.log('\x1b[32mKarte erfolgreich gelöscht!\x1b[0m');
    } catch (error) {
        console.error(error);
    }
}

async function addLabel(cardShortLink, color, name = '') {
    try {
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        console.log(`Füge Label "${color}" (${name || 'ohne Name'}) zu Karte [${cardShortLink}] hinzu...`);
        await apiRequest('POST', `/cards/${card.id}/labels?color=${color}&name=${name}`);
        console.log('\x1b[32mLabel erfolgreich hinzugefügt!\x1b[0m');
    } catch (error) {
        console.error(error);
    }
}

async function addComment(cardShortLink, text) {
    try {
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        console.log(`Füge Kommentar zu Karte [${cardShortLink}] hinzu...`);
        await apiRequest('POST', `/cards/${card.id}/actions/comments`, { text: text });
        console.log('\x1b[32mKommentar erfolgreich hinzugefügt!\x1b[0m');
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
            console.log('Erstelle neue Checkliste "Aufgaben"...');
            checklist = await apiRequest('POST', `/cards/${card.id}/checklists`, { name: 'Aufgaben' });
        }
        console.log(`Füge "${itemName}" zu Checkliste "${checklist.name}" hinzu...`);
        await apiRequest('POST', `/checklists/${checklist.id}/checkItems`, { name: itemName });
        console.log('\x1b[32mChecklisten-Punkt erfolgreich hinzugefügt!\x1b[0m');
        
        // Lokales active_ticket.json synchronisieren
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
        if(!foundItem) throw `Checklisten-Punkt "${itemName}" nicht gefunden!`;
        console.log(`Markiere "${foundItem.item.name}" als erledigt...`);
        await apiRequest('PUT', `/cards/${card.id}/checkItem/${foundItem.item.id}`, { state: 'complete' });
        console.log('\x1b[32mChecklisten-Punkt als erledigt markiert!\x1b[0m');
        
        // Lokales active_ticket.json synchronisieren
        const updatedChecklists = await apiRequest('GET', `/cards/${card.id}/checklists`);
        await syncLocalActiveTicket(card, updatedChecklists);
    } catch (error) {
        console.error(error);
    }
}

async function searchCards(query) {
    try {
        console.log(`Suche nach "${query}" auf dem Board...`);
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        const cards = await apiRequest('GET', `/boards/${boardId}/cards`);
        const matches = cards.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || (c.desc && c.desc.toLowerCase().includes(query.toLowerCase())));
        if(matches.length === 0) {
            console.log('Keine passenden Karten gefunden.');
            return;
        }
        matches.forEach(card => {
            const list = lists.find(l => l.id === card.idList);
            console.log(`\n\x1b[36m- [${card.shortLink}] ${card.name}\x1b[0m`);
            console.log(`  Liste: ${list ? list.name : 'Unbekannt'}`);
            if(card.desc) console.log(`  Beschreibung: ${card.desc.substring(0, 100)}...`);
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
        console.log('Rufe Listen vom Trello-Board ab...');
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        
        for (const list of lists) {
            console.log(`\nPrüfe Liste: "${list.name}"...`);
            const cards = await apiRequest('GET', `/lists/${list.id}/cards`);
            if (cards.length <= 1) {
                console.log('  Zu wenige Karten zum Sortieren.');
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
                console.log('  Liste ist bereits korrekt sortiert.');
                continue;
            }
            
            console.log(`  Sortiere ${sortedCards.length} Karten in der Liste...`);
            for (let i = 0; i < sortedCards.length; i++) {
                const card = sortedCards[i];
                const newPos = i + 1;
                console.log(`    Bewege Karte [${card.shortLink}] "${card.name}" auf Position ${newPos}...`);
                await apiRequest('PUT', `/cards/${card.id}`, { pos: newPos });
            }
            console.log(`  Liste "${list.name}" erfolgreich sortiert.`);
        }
        console.log('\n\x1b[32mAlle Listen erfolgreich sortiert!\x1b[0m');
    } catch (error) {
        console.error('Fehler beim Sortieren des Boards:', error);
    }
}

async function backupBoard() {
    try {
        console.log('Erstelle Backup des Trello-Boards...');
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        let output = `Trello Board Backup vom ${new Date().toLocaleString('de-DE')}\n`;
        output += `===============================================\n`;
        
        for (const list of lists) {
            output += `\n=== List: ${list.name} (ID: ${list.id}) ===\n`;
            const cards = await apiRequest('GET', `/lists/${list.id}/cards`);
            if(cards.length === 0) {
                output += '  (Keine Aufgaben)\n';
            }
            else {
                cards.forEach(card => {
                    output += `  - [${card.shortLink}] ${card.name}\n`;
                    if (card.desc) {
                        output += `    Beschreibung: ${card.desc.replace(/\\r?\\n/g, '\\n    ')}\n`;
                    }
                });
            }
        }
        
        // Backup im lokalen .trello/ Ordner des Projekts speichern, falls vorhanden, sonst neben dem Script
		let backupFilePath=path.join(process.cwd(),'.agents','board_backup.txt');
		if(!fs.existsSync(path.dirname(backupFilePath))) {
			backupFilePath=path.join(__dirname,'board_backup.txt');
		}
        
        fs.writeFileSync(backupFilePath, output, 'utf8');
        console.log(`\x1b[32mBackup erfolgreich unter ${backupFilePath} gespeichert!\x1b[0m`);
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
				console.log(`  -> Bette ${missingImages.length} Bild-Anhänge in Beschreibung ein...`);
				desc=desc.trim();
				desc+='\n\n---\n### 📎 Bilder-Anhänge:\n';
				for(const img of missingImages) {
					desc+=`![${img.name}](${img.url})\n`;
				}
				await apiRequest('PUT',`/cards/${card.id}`,{desc:desc});
				card.desc=desc;
			}
		}
	}
	catch(e) {
		console.error(`  -> Fehler beim Einbetten von Bildern für Karte ${card.shortLink}:`,e.message);
	}
}

async function processInbox() {
    try {
        console.log(`Rufe Listen ab, um Inbox "${INBOX_LIST_NAME}" zu finden...`);
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        const inboxList = lists.find(l => l.name.toLowerCase().includes(INBOX_LIST_NAME.toLowerCase()));
        if (!inboxList) {
            console.error(`Fehler: Inbox-Liste "${INBOX_LIST_NAME}" nicht gefunden.`);
            return;
        }
        
        console.log(`Hole Karten aus Inbox-Liste "${inboxList.name}"...`);
        const cards = await apiRequest('GET', `/lists/${inboxList.id}/cards`);
        
        if (cards.length === 0) {
            console.log('Keine neuen E-Mail-Tickets in der Inbox.');
            return;
        }
        
        console.log(`${cards.length} Ticket(s) in der Inbox gefunden. Verarbeite...`);
        
        for (const card of cards) {
            console.log(`\nVerarbeite Ticket: "${card.name}" [${card.shortLink}]`);
            
            // Bilder einbetten
            await embedMissingImages(card);
            
            const { cleanTitle, matchedLabel } = parsePrefixAndCleanTitle(card.name);
            
            // 1. Titel aktualisieren falls geändert (Präfix entfernt)
            if (cleanTitle !== card.name) {
                console.log(`  -> Ändere Titel zu: "${cleanTitle}"`);
                await apiRequest('PUT', `/cards/${card.id}`, { name: cleanTitle });
            }
            
            // 2. Label zuweisen falls eins gematcht hat
            if (matchedLabel) {
                const hasLabel = card.labels && card.labels.some(l => l.name === matchedLabel.name);
                if (!hasLabel) {
                    console.log(`  -> Weise Label "${matchedLabel.name}" (${matchedLabel.color}) zu...`);
                    await apiRequest('POST', `/cards/${card.id}/labels?color=${matchedLabel.color}&name=${encodeURIComponent(matchedLabel.name)}`);
                }
            }
            
            // 3. In Ziel-Liste verschieben (deaktiviert - Benutzer schiebt Karten manuell)
            // console.log(`  -> Verschiebe Karte in Liste "${targetList.name}"...`);
            // await apiRequest('PUT', `/cards/${card.id}?idList=${targetList.id}`);
        }
        
        // console.log('\nSortiere das Board nach Prioritäten...');
        // await sortBoard(); // Automatische Sortierung deaktiviert
        console.log('\x1b[32mInbox-Verarbeitung erfolgreich abgeschlossen!\x1b[0m');
    } catch (error) {
        console.error('Fehler bei der Inbox-Verarbeitung:', error);
    }
}

async function syncLabelsAndCards() {
	try {
		console.log('Synchronisiere globale Labels mit dem Board...');
		const boardLabels=await apiRequest('GET',`/boards/${boardId}/labels`);
		
		for(const mapping of labelMappings) {
			const existingLabel=boardLabels.find(l=>l.name.toLowerCase()===mapping.name.toLowerCase());
			
			if(existingLabel) {
				if(existingLabel.color!==mapping.color) {
					console.log(`  -> Aktualisiere Label-Farbe für "${mapping.name}" zu ${mapping.color}...`);
					await apiRequest('PUT',`/labels/${existingLabel.id}`,{color:mapping.color});
				}
			}
			else {
				console.log(`  -> Erstelle neues Label "${mapping.name}" (${mapping.color}) auf dem Board...`);
				await apiRequest('POST',`/boards/${boardId}/labels`,{name:mapping.name,color:mapping.color});
			}
		}
		
		console.log('Prüfe und bereinige Karten-Titel und -Labels auf dem gesamten Board...');
		const cards=await apiRequest('GET',`/boards/${boardId}/cards`);
		const updatedLabels=await apiRequest('GET',`/boards/${boardId}/labels`);
		
		for(const card of cards) {
			const {cleanTitle,matchedLabel}=parsePrefixAndCleanTitle(card.name);
			
			if(cleanTitle!==card.name) {
				console.log(`  -> Passe Titel von [${card.shortLink}] an: "${cleanTitle}"`);
				await apiRequest('PUT',`/cards/${card.id}`,{name:cleanTitle});
			}
			
			if(matchedLabel) {
				const boardLabel=updatedLabels.find(l=>l.name.toLowerCase()===matchedLabel.name.toLowerCase());
				const hasLabel=card.idLabels&&card.idLabels.includes(boardLabel.id);
				
				if(!hasLabel&&boardLabel) {
					console.log(`  -> Weise Karte [${card.shortLink}] das Label "${boardLabel.name}" zu...`);
					await apiRequest('POST',`/cards/${card.id}/idLabels`,{value:boardLabel.id});
				}
			}
		}
		console.log('\x1b[32mSynchronisation des Boards erfolgreich abgeschlossen!\x1b[0m');
	}
	catch(error) {
		console.error('Fehler bei der Synchronisation:',error);
	}
}

async function listenInbox(intervalMinutes = 5) {
    console.log(`\n\x1b[35m=== Trello Inbox Polling Daemon gestartet ===\x1b[0m`);
    console.log(`Überwache Liste: "${INBOX_LIST_NAME}"`);
    console.log(`Intervall: alle ${intervalMinutes} Minuten`);
    console.log(`Drücke Strg+C zum Beenden.\n`);
    
    // Erste Ausführung sofort
    await processInbox();
    
    setInterval(async () => {
        const timestamp = new Date().toLocaleString('de-DE');
        console.log(`\n[${timestamp}] Überprüfe Inbox...`);
        await processInbox();
    }, intervalMinutes * 60000);
}

async function completeSession(cardShortLink, manualTimeEstimate = '') {
    try {
        // 1. Trello-Karte holen und verschieben
        const card = await apiRequest('GET', `/cards/${cardShortLink}`);
        const lists = await apiRequest('GET', `/boards/${boardId}/lists`);
        const targetList = lists.find(l => l.name.toLowerCase().includes(COMPLETED_LIST_NAME.toLowerCase())) ||
                           lists.find(l => l.name.toLowerCase().includes('implemented') || l.name.toLowerCase().includes('done') || l.name.toLowerCase().includes('completed') || l.name.toLowerCase().includes('complete'));
        if(!targetList) throw `Keine passende Liste ("${COMPLETED_LIST_NAME}", "Implemented", "Completed" oder "Done") gefunden!`;
        
        console.log(`Bewege Karte [${cardShortLink}] "${card.name}" in Liste "${targetList.name}"...`);
        await apiRequest('PUT', `/cards/${card.id}?idList=${targetList.id}`);
        
        // Lokale active_ticket.json löschen falls vorhanden
        const activeTicketPath = path.join(process.cwd(), 'active_ticket.json');
        if(fs.existsSync(activeTicketPath)) {
            try {
                fs.unlinkSync(activeTicketPath);
                console.log('Lokales active_ticket.json gelöscht.');
            } catch (e) {
                // Ignorieren
            }
        }
        
        // 2. Billing Log einlesen (versuchen im Projektordner, sonst relativ zum Script)
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
            console.log('Hinweis: billing-log.md existiert nicht, überspringe automatischen Log-Eintrag.');
            return;
        }
        
        let content = fs.readFileSync(billingLogPath, 'utf8');
        
        // Finde aktive Zeile im Logbuch
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
            console.log('Keine aktive Session im Logbuch gefunden. Karte wurde verschoben, Log unverändert.');
            return;
        }
        
        // 3. Zeiten berechnen
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
        
        // Zeile im Logbuch aktualisieren
        lines[activeLineIndex] = `| ${dateStr} | ${startTimeStr} | ${endTimeStr} | ${actualTimeText} | ${estTimeText} | Erledigt (${card.name}) |`;
        
        // 4. Rechnungsposition generieren
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
        console.log('\x1b[32mSession erfolgreich beendet und im Logbuch (.agents/rules/billing-log.md) dokumentiert!\x1b[0m');
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
        console.error('Verwendung: node trello.js add "Kartentitel" ["Kartenbeschreibung"] ["ListenName"]');
        process.exit(1);
    }
    addCard(title, desc, listName);
}
else if(command === 'move') {
    const cardLink = args[1];
    const listName = args[2];
    if(!cardLink || !listName) {
        console.error('Verwendung: node trello.js move "shortLink" "ListenName"');
        process.exit(1);
    }
    moveCard(cardLink, listName);
}
else if(command === 'archive') {
    const cardLink = args[1];
    if(!cardLink) {
        console.error('Verwendung: node trello.js archive "shortLink"');
        process.exit(1);
    }
    archiveCard(cardLink);
}
else if(command === 'delete') {
    const cardLink = args[1];
    if(!cardLink) {
        console.error('Verwendung: node trello.js delete "shortLink"');
        process.exit(1);
    }
    deleteCard(cardLink);
}
else if(command === 'label') {
    const cardLink = args[1];
    const color = args[2];
    const labelName = args[3] || '';
    if(!cardLink || !color) {
        console.error('Verwendung: node trello.js label "shortLink" "Farbe" ["LabelName"]');
        process.exit(1);
    }
    addLabel(cardLink, color, labelName);
}
else if(command === 'comment') {
    const cardLink = args[1];
    const text = args[2];
    if(!cardLink || !text) {
        console.error('Verwendung: node trello.js comment "shortLink" "Kommentartext"');
        process.exit(1);
    }
    addComment(cardLink, text);
}
else if(command === 'check') {
    const cardLink = args[1];
    const itemName = args[2];
    if(!cardLink || !itemName) {
        console.error('Verwendung: node trello.js check "shortLink" "AufgabenName"');
        process.exit(1);
    }
    addCheckItem(cardLink, itemName);
}
else if(command === 'check-done') {
    const cardLink = args[1];
    const itemName = args[2];
    if(!cardLink || !itemName) {
        console.error('Verwendung: node trello.js check-done "shortLink" "AufgabenName"');
        process.exit(1);
    }
    completeCheckItem(cardLink, itemName);
}
else if(command === 'search') {
    const query = args[1];
    if(!query) {
        console.error('Verwendung: node trello.js search "Suchbegriff"');
        process.exit(1);
    }
    searchCards(query);
}
else if(command === 'complete') {
    const cardLink = args[1];
    const manualTimeEstimate = args[2] || '';
    if(!cardLink) {
        console.error('Verwendung: node trello.js complete "shortLink" ["ManuelleZeitschätzung"]');
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
        console.error('Verwendung: node trello.js start "shortLink"');
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
    console.log('Unbekannter Befehl. Verfügbar: list, add, move, start, archive, delete, label, comment, check, check-done, search, complete, backup, sort, inbox, listen, sync');
}
