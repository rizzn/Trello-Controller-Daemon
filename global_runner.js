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

async function processAllBoards() {
	try {
		const projects=JSON.parse(fs.readFileSync(projectsPath,'utf8'));
		const boards=projects.TRELLO_BOARDS||{};
		const boardUrls=Object.keys(boards);

		for(const boardUrl of boardUrls) {
			const boardConfig=boards[boardUrl];
			let boardDisplayName=boardUrl;
			if(boardConfig.LOCAL_PROJECTS&&Array.isArray(boardConfig.LOCAL_PROJECTS)&&boardConfig.LOCAL_PROJECTS.length>0) {
				const projectNames=boardConfig.LOCAL_PROJECTS.map(p=>p.name).filter(Boolean);
				if(projectNames.length>0) {
					boardDisplayName=`${boardUrl} (${projectNames.join(', ')})`;
				}
			}
			
			let runCwd=__dirname;
			if(boardConfig.LOCAL_PROJECTS&&Array.isArray(boardConfig.LOCAL_PROJECTS)&&boardConfig.LOCAL_PROJECTS.length>0) {
				const firstProject=boardConfig.LOCAL_PROJECTS[0];
				if(firstProject&&firstProject.folder_path) {
					const folder=firstProject.folder_path;
					if(fs.existsSync(folder)) {
						runCwd=folder;
					}
				}
			}

			try {
				const syncOutput=execSync(`node .agents/trello/controller.js sync`,{
					cwd:runCwd,
					env:{
						...process.env,
						TRELLO_BOARD_CONTEXT:boardUrl
					},
					encoding:'utf8',
					stdio:'pipe'
				});

				const inboxOutput=execSync(`node .agents/trello/controller.js inbox`,{
					cwd:runCwd,
					env:{
						...process.env,
						TRELLO_BOARD_CONTEXT:boardUrl
					},
					encoding:'utf8',
					stdio:'pipe'
				});
			}
			catch(error) {
				log(`Error processing board ${boardUrl}:\n${error.stdout||error.message}`);
			}
		}
	}
	catch(e) {
		log(`Critical error in global runner iteration: ${e.message}`);
	}
}

// Run 6 times, every 10 seconds (total 1 minute)
async function startRunnerLoop() {
	log('Starting Trello Daemon loop: 6 iterations, every 10 seconds...');
	for(let i=0;i<6;i++) {
		const iterationStart=Date.now();
		log(`Iteration ${i+1}/6 started.`);
		await processAllBoards();
		const elapsed=Date.now()-iterationStart;
		const sleepTime=10000-elapsed;
		if(sleepTime>0&&i<5) {
			await new Promise(resolve=>setTimeout(resolve,sleepTime));
		}
	}
	log('Daemon loop completed.');
}

startRunnerLoop();
