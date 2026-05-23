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
	log('Error: projects.json does not exist.');
	process.exit(1);
}

try {
	const projects=JSON.parse(fs.readFileSync(projectsPath,'utf8'));
	const projectPaths=Object.keys(projects);
	log(`Starting Trello inbox processing for ${projectPaths.length} project(s)...`);

	for(const projectPath of projectPaths) {
		if(!fs.existsSync(projectPath)) {
			log(`Warning: Project path does not exist: ${projectPath}`);
			continue;
		}
		
		log(`Processing project: ${path.basename(projectPath)}...`);
		try {
			// 1. Synchronize board labels and existing cards
			const syncOutput=execSync(`node .agents/trello/controller.js sync`,{
				cwd:projectPath,
				encoding:'utf8',
				stdio:'pipe'
			});
			log(`Sync result:\n${syncOutput.trim()}`);

			// 2. Process inbox
			const inboxOutput=execSync(`node .agents/trello/controller.js inbox`,{
				cwd:projectPath,
				encoding:'utf8',
				stdio:'pipe'
			});
			log(`Inbox result:\n${inboxOutput.trim()}`);
		}
		catch(error) {
			log(`Error processing project ${path.basename(projectPath)}:\n${error.stdout||error.message}`);
		}
	}
	log('All projects processed.');
}
catch(e) {
	log(`Critical error in global runner: ${e.message}`);
}
