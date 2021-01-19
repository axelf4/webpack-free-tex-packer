"use strict";

const fs = require('fs');
const path = require('path');
const texturePacker = require('free-tex-packer-core');
const appInfo = require('./package.json');

const supportedExtensions = ['.png', '.jpg', '.jpeg'];

function removePrefix(s, prefix) {
	return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

/**
 * Returns all entries of the specified directory recursively.
 *
 * All returned paths are normalized.
 *
 * @param dir The parent directory in question.
 * @param list The later returned array that entries are added to.
 * @return All directories and files in the directory as Dirent:s.
 */
function getDirectoryEntriesRec(dir, list = []) {
	for (let dirent of fs.readdirSync(dir, {withFileTypes: true})) {
		let entryPath = path.join(dir, dirent.name);
		list.push({
			path: entryPath,
			isDirectory: dirent.isDirectory(),
		});
		if (dirent.isDirectory())
			getDirectoryEntriesRec(entryPath, list);
	}

	return list
}

class WebpackFreeTexPacker {
    constructor(src, dest = '.', options = {}) {
        this.src = Array.isArray(src) ? src : [src];
        this.dest = dest;

        this.options = options;
        this.options.appInfo = appInfo;

		this.prevFiles = new Set();
    }

    apply(compiler) {
		compiler.hooks.emit.tapAsync('WebpackFreeTexPacker', this.emitHookHandler.bind(this));
	}

	emitHookHandler(compilation, callback) {
		const compiler = compilation.compiler;
		
		let files = new Set();
		for(let srcPath of this.src) {
			srcPath = path.normalize(srcPath);
			if (!fs.existsSync(srcPath)) throw new Error(`Path ${srcPath} does not exist`)

			if (fs.statSync(srcPath).isDirectory()) {
				compilation.contextDependencies.add(srcPath);

				for (let {path: subPath, isDirectory} of getDirectoryEntriesRec(srcPath)) {
					if (isDirectory) {
						compilation.contextDependencies.add(subPath);
					} else {
						let extension = path.extname(subPath);
						if (supportedExtensions.includes(extension.toLowerCase())) {
							// Paths are normalized: Get base path by removing prefix string
							files.add({path: subPath, name: removePrefix(subPath, srcPath + path.sep)});
						}

						compilation.fileDependencies.add(subPath);
					}
				}
			} else {
				files.add({path: srcPath, name: path.basename(srcPath)});
				compilation.fileDependencies.add(srcPath);
			}
		}

		let changed = files.size != this.prevFiles.size
			|| Array.from(files).some(({path: file}) =>
				!this.prevFiles.has(file) || compiler.modifiedFiles.has(file));
		if (!changed || files.size === 0) {
			callback();
			return;
		}
		this.prevFiles = new Set(Array.from(files).map(({path: file}) => file));

		let images = Array.from(files)
			.map(({path: file, name}) => ({
				path: name,
				contents: fs.readFileSync(file),
			}));

        texturePacker(images, this.options, (files, error) => {
			if (error) {
				compilation.errors.push(error);
			} else {
				for (let {name, buffer} of files) {
					compilation.emitAsset(`${this.dest}/${name}`, {
						source() { return buffer; },
						size() { return buffer.length; },
					});
				}
			}

            callback();
        });
    }
}

module.exports = WebpackFreeTexPacker;
