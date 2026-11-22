// Browser side of web.cpp, linked with --pre-js so that FS, IDBFS and ccall are in scope.
// Must stay parsable by the acorn version shipped with Emscripten 3.1.6.
(function () {
	var ROOT = '/openboardview';
	var BOARD_EXTENSIONS = ['brd', 'bdv', 'bvr', 'bvr3', 'bv', 'cad', 'cae', 'cst', 'fz', 'pcb', 'pcbdoc', 'asc', 'bom'];
	var ready = false;

	function extension(name) {
		var dot = name.lastIndexOf('.');
		return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
	}

	function banner(text) {
		var element = document.getElementById('banner');
		element.firstElementChild.textContent = text;
		element.hidden = !text;
	}

	function call(name, argument) {
		if (argument === undefined) ccall(name, null, [], []);
		else ccall(name, null, ['string'], [argument]);
	}

	/* ---- Storage ----
	 *
	 * IDBFS syncs by making IndexedDB identical to the memory of the tab, deleting what that tab
	 * does not know about. So only one tab, the holder of a Web Lock, may ever write.
	 * Its autoPersist option is not used: it swallows errors, does not exist in 3.1.6 and
	 * doesn't see writes to a file which stays open, like the annotations database.
	 */
	var canSave = false;
	var saving = false;
	var saved = '';

	function acquireLock() {
		return new Promise(function (resolve) {
			if (!navigator.locks) return resolve(false);
			var controller = new AbortController();
			// Not using ifAvailable as the previous page may still hold the lock during a reload
			var timer = setTimeout(function () { controller.abort(); }, 1500);
			navigator.locks.request('openboardview-storage', { signal: controller.signal }, function () {
				clearTimeout(timer);
				resolve(true);
				return new Promise(function () {}); // held until the page goes away
			}).catch(function () { resolve(false); });
		});
	}

	function fingerprint() {
		var entries = [];
		(function walk(dir) {
			FS.readdir(dir).forEach(function (name) {
				if (name === '.' || name === '..') return;
				var path = dir + '/' + name;
				var stat = FS.stat(path);
				var isDir = FS.isDir(stat.mode);
				entries.push(isDir ? [path] : [path, stat.size, stat.mtime.getTime()]);
				if (isDir) walk(path);
			});
		})(ROOT);
		return JSON.stringify(entries);
	}

	function save() {
		if (!canSave || saving) return;
		var current = fingerprint();
		if (current === saved) return;
		saving = true;
		FS.syncfs(false, function (error) {
			saving = false;
			if (error) {
				console.error(error);
				banner('Could not save to browser storage, recent changes will be lost on reload.');
			} else {
				saved = current;
			}
		});
	}

	function mountStorage() {
		addRunDependency('storage');
		FS.mkdir(ROOT);
		FS.mount(IDBFS, {}, ROOT);

		function start(writable, warning) {
			canSave = writable;
			if (writable) {
				saved = fingerprint();
				setInterval(save, 500);
			}
			['config', 'data'].forEach(function (dir) {
				if (!FS.analyzePath(ROOT + '/' + dir).exists) FS.mkdir(ROOT + '/' + dir);
			});
			if (warning) banner(warning);
			removeRunDependency('storage');
		}

		acquireLock().then(function (locked) {
			// Read only once the lock is held, to see everything the previous owner wrote
			FS.syncfs(true, function (error) {
				if (error) {
					// Never write after a failed read, it would erase what is stored
					console.error(error);
					start(false, 'Browser storage is unavailable, nothing will be saved.');
				} else if (locked) {
					start(true);
				} else if (!navigator.locks) {
					start(false, 'Nothing will be saved: saving needs HTTPS or localhost.');
				} else {
					start(false, 'OpenBoardView is open in another tab, changes made in this one will not be saved.');
				}
			});
		});
	}

	window.addEventListener('beforeunload', function (event) {
		if (!canSave || (!saving && fingerprint() === saved)) return;
		save();
		event.preventDefault();
		event.returnValue = 'unsaved';
	});

	/* ---- Files ---- */

	function readFiles(list) {
		return Promise.all(Array.from(list).map(function (file) {
			return new Promise(function (resolve, reject) {
				var reader = new FileReader();
				reader.onload = function () {
					resolve({
						name: file.name.replace(/[\/\\\0]/g, '_').replace(/^\.+/, '_'),
						data: new Uint8Array(reader.result)
					});
				};
				reader.onerror = function () { reject(reader.error); };
				reader.readAsArrayBuffer(file);
			});
		}));
	}

	// Not crypto.subtle, only available in secure contexts. This only names a directory.
	function contentId(files) {
		var a = 0x811c9dc5, b = 0x01000193, size = 0;
		files.forEach(function (file) {
			for (var i = 0; i < file.data.length; i++) {
				a = Math.imul(a ^ file.data[i], 0x01000193);
				b = Math.imul(b ^ file.data[i], 0x5bd1e995);
				b ^= b >>> 15;
			}
			size += file.data.length;
		});
		return (a >>> 0).toString(16) + (b >>> 0).toString(16) + size.toString(16);
	}

	function sameBytes(a, b) {
		if (a.length !== b.length) return false;
		for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
		return true;
	}

	function store(dir, file) {
		var path = dir + '/' + file.name;
		if (FS.analyzePath(path).exists) {
			if (sameBytes(FS.readFile(path), file.data)) return path;
			// Can be annotations or settings which only exist in this browser
			if (!window.confirm('Replace the copy of ' + file.name + ' saved in this browser?')) return path;
		}
		FS.writeFile(path, file.data);
		return path;
	}

	// A board gets a directory named after its content, so that re-opening it finds its annotations
	// and that different boards with the same file name stay apart. Files selected along with it are
	// stored next to it: .asc sets, .conf, images and annotations are looked up there.
	function openBoard(files) {
		if (!files.length) return;
		var main = files.find(function (file) { return BOARD_EXTENSIONS.indexOf(extension(file.name)) >= 0; }) || files[0];
		var identity = [main];
		if (extension(main.name) === 'asc' || extension(main.name) === 'bom') {
			identity = files.filter(function (file) {
				return extension(file.name) === 'asc' || extension(file.name) === 'bom';
			}).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
		}
		var dir = ROOT + '/boards/' + contentId(identity);
		FS.mkdirTree(dir);
		files.forEach(function (file) { store(dir, file); });
		call('obv_web_open', dir + '/' + main.name);
	}

	function attach(files) {
		if (!files.length) return;
		var dir = ROOT + '/attachments/' + contentId([files[0]]);
		FS.mkdirTree(dir);
		call('obv_web_attach', store(dir, files[0]));
	}

	function receive(list, handler) {
		readFiles(list).then(handler).catch(function (error) {
			console.error(error);
			banner('Could not import the file: ' + (error.message || error));
		});
	}

	function pick(inputId, handler) {
		var input = document.getElementById(inputId);
		var chooser = document.getElementById('chooser');
		input.value = ''; // so that picking the same file again triggers onchange
		input.onchange = function () {
			chooser.hidden = true;
			receive(input.files, handler);
		};
		// We run from the main loop rather than from the click handler, which is only fine
		// while the click's user activation lasts. Otherwise show a real button.
		if (navigator.userActivation && !navigator.userActivation.isActive) {
			chooser.hidden = false;
			document.getElementById('chooser-open').onclick = function () {
				chooser.hidden = true;
				input.click();
			};
		} else {
			input.click();
		}
	}

	/* ---- Clipboard ---- */

	function copyFallback(text) {
		var area = document.createElement('textarea');
		area.value = text;
		document.body.appendChild(area);
		area.select();
		document.execCommand('copy');
		document.body.removeChild(area);
	}

	var isMac = /Mac|iPhone|iPad/.test(navigator.platform);

	Module.obv = {
		isMac: isMac,
		pickBoard: function () { pick('board-input', openBoard); },
		pickAttachment: function () { pick('attachment-input', attach); },
		copy: function (text) {
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(text).catch(function () { copyFallback(text); });
			} else {
				copyFallback(text);
			}
		}
	};

	/* ---- Events ---- */

	// Registered in the capture phase to run before SDL, which cancels every Ctrl and function key
	window.addEventListener('keydown', function (event) {
		var key = event.key.toLowerCase();
		var mod = isMac ? event.metaKey : event.ctrlKey;
		// Left to the browser: paste (gives us the paste event), reload, full screen, developer tools
		var browserKey = key === 'f5' || key === 'f11' || key === 'f12' ||
			(mod && !event.altKey && (key === 'v' || key === 'r' || (event.shiftKey && key === 'i')));
		if (browserKey) event.stopImmediatePropagation();
		else if (isMac && mod && (key === 'o' || key === 'f')) event.preventDefault();
	}, true);

	document.addEventListener('paste', function (event) {
		var text = event.clipboardData && event.clipboardData.getData('text/plain');
		if (!ready || !text) return;
		event.preventDefault();
		call('obv_web_paste', text.slice(0, 65536)); // ccall copies strings on the stack
	});

	window.addEventListener('dragover', function (event) { event.preventDefault(); });
	window.addEventListener('drop', function (event) {
		event.preventDefault();
		if (ready && event.dataTransfer.files.length) receive(event.dataTransfer.files, openBoard);
	});

	var canvas = document.getElementById('canvas');
	canvas.addEventListener('contextmenu', function (event) { event.preventDefault(); });
	canvas.addEventListener('mousedown', function (event) {
		window.focus();
		if (event.button === 1) event.preventDefault(); // no auto-scrolling
	});
	canvas.addEventListener('webglcontextlost', function () {
		Module.obvFatal('The graphics context was lost.');
	});

	function wake() { if (ready) call('obv_web_wake'); }
	// Resizing clears the canvas, even when it doesn't change the size SDL sees
	window.addEventListener('resize', wake);
	document.addEventListener('visibilitychange', function () {
		if (!ready) return;
		if (document.visibilityState === 'hidden') save();
		else wake();
	});
	window.addEventListener('pagehide', function () { if (ready) save(); });

	Module.preRun = [].concat(Module.preRun || [], mountStorage);
	var initialized = Module.onRuntimeInitialized;
	Module.onRuntimeInitialized = function () {
		ready = true;
		if (initialized) initialized();
	};
})();
