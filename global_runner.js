const fs=require('fs');
const path=require('path');
const {execSync}=require('child_process');

const projectsPath=path.join(__dirname,'projects.json');
const logPath=path.join(__dirname,'runner.log');

function log(message) {
	const timestamp=new Date().toLocaleString('de-DE');
	const logLine=`[${timestamp}] ${message}\n`;
	fs.appendFileSync(logPath,logLine,'utf8');
	console.log(message);
}

if(!fs.existsSync(projectsPath)) {
	log('Fehler: projects.json existiert nicht.');
	process.exit(1);
}

try {
	const projects=JSON.parse(fs.readFileSync(projectsPath,'utf8'));
	const projectPaths=Object.keys(projects);
	log(`Starte Trello-Inbox-Verarbeitung für ${projectPaths.length} Projekt(e)...`);

	for(const projectPath of projectPaths) {
		if(!fs.existsSync(projectPath)) {
			log(`Warnung: Projektpfad existiert nicht: ${projectPath}`);
			continue;
		}
		
		log(`Verarbeite Projekt: ${path.basename(projectPath)}...`);
		try {
			// 1. Board-Labels und bestehende Karten synchronisieren
			const syncOutput=execSync(`node .agents/trello/controller.js sync`,{
				cwd:projectPath,
				encoding:'utf8',
				stdio:'pipe'
			});
			log(`Sync-Ergebnis:\n${syncOutput.trim()}`);

			// 2. Inbox verarbeiten
			const inboxOutput=execSync(`node .agents/trello/controller.js inbox`,{
				cwd:projectPath,
				encoding:'utf8',
				stdio:'pipe'
			});
			log(`Inbox-Ergebnis:\n${inboxOutput.trim()}`);
		}
		catch(error) {
			log(`Fehler bei Projekt ${path.basename(projectPath)}:\n${error.stdout||error.message}`);
		}
	}
	log('Alle Projekte verarbeitet.');
}
catch(e) {
	log(`Kritischer Fehler im globalen Runner: ${e.message}`);
}
