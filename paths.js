const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS_PATH = path.join(__dirname, 'projects.json');

function readProjects() {
	try {
		return JSON.parse(fs.readFileSync(PROJECTS_PATH, 'utf8'));
	}
	catch(e) {
		return null;
	}
}

/* PATH_VARS FROM projects.json: "*" APPLIES EVERYWHERE, A HOSTNAME KEY OVERRIDES IT ON THAT MACHINE */
function configVars(projects = null, host = os.hostname()) {
	const data = projects || readProjects();
	if(!data) {
		return {};
	}
	const table = data.PATH_VARS || {};
	const hostKey = Object.keys(table).find(k => k.toLowerCase() === host.toLowerCase());
	return {...(table['*'] || {}), ...(hostKey ? table[hostKey] : {})};
}

/* LOOKUP SCOPE: PROCESS ENV < projects.json PATH_VARS (THE PROJECT FILE WINS) */
function defaultScope() {
	return {...process.env, ...configVars()};
}

/* EXPAND %VAR%, ${VAR} AND ~ TOKENS; RETURNS NULL FOR DISABLED ENTRIES ('-' OR EMPTY) */
function expandPath(raw, env = defaultScope(), depth = 0) {
	if(!raw || raw === '-') {
		return null;
	}
	const lookup = name => {
		const key = Object.keys(env).find(k => k.toUpperCase() === name.toUpperCase());
		if(key && depth < 3) {
			// Values may themselves use tokens, e.g. "HTDOCS": "%WWW%/htdocs"
			return expandPath(String(env[key]), env, depth + 1);
		}
		return null;
	};
	let unresolved = false;
	let expanded = raw.replace(/%([A-Za-z0-9_]+)%|\$\{([A-Za-z0-9_]+)\}/g, (match, a, b) => {
		const value = lookup(a || b);
		if(value === null) {
			unresolved = true;
			return match;
		}
		return value;
	});
	if(expanded.startsWith('~')) {
		expanded = path.join(os.homedir(), expanded.slice(1));
	}
	if(unresolved) {
		return null;
	}
	return path.normalize(expanded);
}

function normalizeForCompare(p) {
	return p ? path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '';
}

/* LAST PATH SEGMENT OF A (POSSIBLY UNEXPANDED) folder_path, E.G. '%HTDOCS%/pec' -> 'pec' */
function folderBaseName(raw) {
	if(!raw || raw === '-') {
		return '';
	}
	return raw.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop().toLowerCase();
}

/* TRUE IF THE GIVEN DIRECTORY BELONGS TO THE PROJECT ENTRY (EXACT PATH FIRST, BASENAME FALLBACK) */
function projectMatchesDir(project, dir, env = defaultScope()) {
	if(!project || !project.folder_path || project.folder_path === '-') {
		return false;
	}
	const expanded = expandPath(project.folder_path, env);
	if(expanded && normalizeForCompare(expanded) === normalizeForCompare(dir)) {
		return true;
	}
	return folderBaseName(project.folder_path) === path.basename(dir).toLowerCase();
}

/* LOCATE {boardUrl, board, project} BY BOARD CONTEXT (URL / KEY / PROJECT NAME) OR BY DIRECTORY */
function findProject(projects, {context = '', cwd = process.cwd(), env = defaultScope()} = {}) {
	const boards = (projects && projects.TRELLO_BOARDS) || {};
	const entries = [];
	for(const boardUrl of Object.keys(boards)) {
		for(const project of (boards[boardUrl].LOCAL_PROJECTS || [])) {
			entries.push({boardUrl, board: boards[boardUrl], project});
		}
	}
	if(context) {
		const c = context.toLowerCase().trim();
		const byName = entries.find(e => e.project.name && e.project.name.toLowerCase() === c);
		if(byName) {
			return byName;
		}
		const byKey = entries.find(e => e.boardUrl.toLowerCase() === c || e.boardUrl.toLowerCase().includes(c));
		if(byKey) {
			return byKey;
		}
		return entries.find(e => e.project.name && e.project.name.toLowerCase().includes(c)) || null;
	}
	const exact = entries.find(e => {
		const expanded = expandPath(e.project.folder_path, env);
		return expanded && normalizeForCompare(expanded) === normalizeForCompare(cwd);
	});
	return exact || entries.find(e => projectMatchesDir(e.project, cwd, env)) || null;
}

/* WORKSPACE ROOT FOR A PROJECT: CWD IF IT MATCHES, ELSE THE EXPANDED folder_path IF IT EXISTS */
function resolveWorkspaceRoot(project, cwd = process.cwd(), env = defaultScope()) {
	if(projectMatchesDir(project, cwd, env)) {
		return cwd;
	}
	const expanded = expandPath(project && project.folder_path, env);
	if(expanded && fs.existsSync(expanded)) {
		return expanded;
	}
	return null;
}

/* OPTIONAL BILLING HOOK: THE MODULE NAMED BY BILLING_MODULE IN projects.json (TOKENS ALLOWED), null WITHOUT IT OR IF THE PATH DOES NOT RESOLVE */
function loadBilling(projects = readProjects(), env = defaultScope()) {
	const file = expandPath(projects && projects.BILLING_MODULE, env);
	return file && fs.existsSync(file) ? require(file) : null;
}

module.exports = {
	loadBilling,
	configVars,
	defaultScope,
	expandPath,
	folderBaseName,
	projectMatchesDir,
	findProject,
	resolveWorkspaceRoot
};
