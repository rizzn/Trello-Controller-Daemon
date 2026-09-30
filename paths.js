const fs = require('fs');
const path = require('path');
const os = require('os');

/* ROOT OF THE CENTRAL .agents FOLDER: FIRST ANCESTOR NAMED .agents (SYMLINKS ARE ALREADY RESOLVED), ELSE tools/<tool>/../.. */
function findAgentsRoot(dir) {
	for(let d = dir; d !== path.dirname(d); d = path.dirname(d)) {
		if(path.basename(d).toLowerCase() === '.agents') {
			return d;
		}
	}
	return path.join(dir, '..', '..');
}
const AGENTS_ROOT = findAgentsRoot(__dirname);
const PROJECTS_PATH = path.join(__dirname, 'projects.json');

/* PATH_VARS FROM projects.json: "*" APPLIES EVERYWHERE, A HOSTNAME KEY OVERRIDES IT ON THAT MACHINE */
function configVars(projects = null, host = os.hostname()) {
	let data = projects;
	if(!data) {
		try {
			data = JSON.parse(fs.readFileSync(PROJECTS_PATH, 'utf8'));
		}
		catch(e) {
			return {};
		}
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
			// Values may themselves use tokens, e.g. "HTDOCS": "%AGENTS_ROOT%/../htdocs"
			return expandPath(String(env[key]), env, depth + 1);
		}
		if(name.toUpperCase() === 'AGENTS_ROOT') {
			return AGENTS_ROOT;
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

/* BILLING LOG: RELATIVE NAMES RESOLVE INTO .agents/billing/, ABSOLUTE ONES FALL BACK TO THEIR BASENAME THERE */
function resolveBillingPath(raw, cwd = process.cwd(), env = defaultScope()) {
	if(raw === '-') {
		return null;
	}
	const name = raw || 'billing-log.md';
	const expanded = expandPath(name, env);
	if(expanded && path.isAbsolute(expanded) && fs.existsSync(expanded)) {
		return expanded;
	}
	const base = path.basename((expanded || name).replace(/\\/g, '/'));
	const local = path.join(cwd, '.agents', 'billing', base);
	if(fs.existsSync(local)) {
		return local;
	}
	return path.join(AGENTS_ROOT, 'billing', base);
}

/* PATH RELATIVE TO THE .agents ROOT FOR LOGS AND REPORTS, E.G. '.agents/billing/billing-log-pec.md' */
function toAgentsRelative(p) {
	if(!p) {
		return '';
	}
	const rel = path.relative(AGENTS_ROOT, p).replace(/\\/g, '/');
	if(!rel.startsWith('..') && !path.isAbsolute(rel)) {
		return `.agents/${rel}`;
	}
	// Reached through a project's .agents symlink (e.g. <project>/.agents/billing/x.md)
	const norm = p.replace(/\\/g, '/');
	const idx = norm.lastIndexOf('/.agents/');
	return idx !== -1 ? norm.slice(idx + 1) : path.basename(p);
}

module.exports = {
	AGENTS_ROOT,
	configVars,
	defaultScope,
	expandPath,
	folderBaseName,
	projectMatchesDir,
	findProject,
	resolveWorkspaceRoot,
	resolveBillingPath,
	toAgentsRelative
};
