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
	const boardUrls=Object.keys(projects);
	log(`Starting Trello inbox processing for ${boardUrls.length} board(s)...`);

	for(const boardUrl of boardUrls) {
		const boardConfig=projects[boardUrl];
		log(`Processing board: ${boardUrl}...`);
		
		// If there are projects, use the first one's folder_path as cwd so that billing logs can be saved in the right workspace
		// Otherwise, run in the script's directory (daemon context)
		let runCwd=__dirname;
		if(boardConfig.PROJECTS&&Array.isArray(boardConfig.PROJECTS)&&boardConfig.PROJECTS.length>0) {
			const firstProject=boardConfig.PROJECTS[0];
			if(firstProject&&firstProject.folder_path) {
				const folder=firstProject.folder_path;
				if(fs.existsSync(folder)) {
					runCwd=folder;
				}
			}
		}

		try {
			// 1. Synchronize board labels and existing cards
			const syncOutput=execSync(`node .agents/trello/controller.js sync`,{
				cwd:runCwd,
				env:{
					...process.env,
					TRELLO_BOARD_CONTEXT:boardUrl
				},
				encoding:'utf8',
				stdio:'pipe'
			});
			log(`Sync result:\n${syncOutput.trim()}`);

			// 2. Process inbox
			const inboxOutput=execSync(`node .agents/trello/controller.js inbox`,{
				cwd:runCwd,
				env:{
					...process.env,
					TRELLO_BOARD_CONTEXT:boardUrl
				},
				encoding:'utf8',
				stdio:'pipe'
			});
			log(`Inbox result:\n${inboxOutput.trim()}`);
		}
		catch(error) {
			log(`Error processing board ${boardUrl}:\n${error.stdout||error.message}`);
		}
	}
	log('All boards processed.');
}
catch(e) {
	log(`Critical error in global runner: ${e.message}`);
}
