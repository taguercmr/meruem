/*
 * Workspace-bounded tools for Meruem Agent.
 */

define(function (require, exports, module) {
    "use strict";

    var ProjectManager = brackets.getModule("project/ProjectManager"),
        FileSystem     = brackets.getModule("filesystem/FileSystem"),
        FileUtils      = brackets.getModule("file/FileUtils");

    var MAX_READ_CHARS   = 24000,
        MAX_LIST_ENTRIES = 200,
        MAX_SEARCH_HITS  = 40,
        MAX_SEARCH_FILES = 400,
        IGNORE_DIR_NAMES = {
            "node_modules": true,
            ".git": true,
            "dist": true,
            "bower_components": true
        };

    function _rootPath() {
        var root = ProjectManager.getProjectRoot();
        return root ? root.fullPath : null;
    }

    function _normalizeRel(relPath) {
        var p = String(relPath || ".").replace(/\\/g, "/");
        if (!p || p === "/") {
            p = ".";
        }
        while (p.indexOf("./") === 0) {
            p = p.slice(2);
        }
        return p;
    }

    /**
     * Resolve a project-relative path. Rejects escapes outside the project root.
     * @return {{ok:true, abs:string, rel:string}|{ok:false, error:string}}
     */
    function resolveInProject(relPath) {
        var root = _rootPath();
        if (!root) {
            return { ok: false, error: "Aucun projet ouvert." };
        }
        var rel = _normalizeRel(relPath);
        if (rel.indexOf("..") !== -1) {
            return { ok: false, error: "Chemin interdit (…)." };
        }
        var abs;
        if (rel === ".") {
            abs = root;
        } else {
            abs = root + rel.replace(/^\//, "");
            if (abs.charAt(abs.length - 1) !== "/" && rel.slice(-1) === "/") {
                abs += "/";
            }
        }
        // Ensure abs is under root (case-insensitive on Windows)
        var rootNorm = root.replace(/\\/g, "/").toLowerCase();
        var absNorm  = abs.replace(/\\/g, "/").toLowerCase();
        if (absNorm.indexOf(rootNorm) !== 0) {
            return { ok: false, error: "Chemin hors du projet." };
        }
        return { ok: true, abs: abs, rel: rel === "." ? "." : rel.replace(/^\//, "") };
    }

    function list_dir(args) {
        var deferred = new $.Deferred();
        var resolved = resolveInProject((args && args.path) || ".");
        if (!resolved.ok) {
            deferred.resolve(JSON.stringify({ error: resolved.error }));
            return deferred.promise();
        }

        var entry = FileSystem.getDirectoryForPath(
            resolved.abs.slice(-1) === "/" ? resolved.abs : resolved.abs + "/"
        );
        // If path looks like a file, try as directory with trailing slash already handled
        if (resolved.rel !== "." && resolved.rel.indexOf(".") !== -1 && resolved.rel.slice(-1) !== "/") {
            // Still try as directory first via resolve
        }

        FileSystem.resolve(resolved.abs, function (err, fsEntry) {
            if (err || !fsEntry) {
                deferred.resolve(JSON.stringify({ error: "Introuvable: " + resolved.rel }));
                return;
            }
            if (fsEntry.isFile) {
                deferred.resolve(JSON.stringify({
                    path: resolved.rel,
                    type: "file",
                    note: "Ce chemin est un fichier. Utilise read_file."
                }));
                return;
            }
            fsEntry.getContents(function (gErr, contents) {
                if (gErr) {
                    deferred.resolve(JSON.stringify({ error: String(gErr) }));
                    return;
                }
                var items = (contents || []).slice(0, MAX_LIST_ENTRIES).map(function (item) {
                    return {
                        name: item.name,
                        type: item.isDirectory ? "dir" : "file"
                    };
                });
                deferred.resolve(JSON.stringify({
                    path: resolved.rel,
                    entries: items,
                    truncated: (contents || []).length > MAX_LIST_ENTRIES
                }, null, 2));
            });
        });

        return deferred.promise();
    }

    function read_file(args) {
        var deferred = new $.Deferred();
        var resolved = resolveInProject(args && args.path);
        if (!resolved.ok) {
            deferred.resolve(JSON.stringify({ error: resolved.error }));
            return deferred.promise();
        }
        if (!args || !args.path || args.path === ".") {
            deferred.resolve(JSON.stringify({ error: "path requis" }));
            return deferred.promise();
        }

        var file = FileSystem.getFileForPath(resolved.abs);
        file.read(function (err, data) {
            if (err) {
                deferred.resolve(JSON.stringify({ error: String(err), path: resolved.rel }));
                return;
            }
            var text = String(data || "");
            var truncated = text.length > MAX_READ_CHARS;
            if (truncated) {
                text = text.slice(0, MAX_READ_CHARS);
            }
            deferred.resolve(JSON.stringify({
                path: resolved.rel,
                truncated: truncated,
                content: text
            }));
        });
        return deferred.promise();
    }

    function _shouldSkipPath(fullPath) {
        var parts = fullPath.replace(/\\/g, "/").split("/");
        for (var i = 0; i < parts.length; i++) {
            if (IGNORE_DIR_NAMES[parts[i]]) {
                return true;
            }
        }
        return false;
    }

    function search_text(args) {
        var deferred = new $.Deferred();
        var query = args && args.query;
        if (!query || String(query).length < 2) {
            deferred.resolve(JSON.stringify({ error: "query trop courte (min 2)" }));
            return deferred.promise();
        }
        var q = String(query);
        var qLower = q.toLowerCase();
        var maxHits = Math.min(MAX_SEARCH_HITS, parseInt(args.max_results, 10) || MAX_SEARCH_HITS);

        ProjectManager.getAllFiles(null, true).done(function (files) {
            var hits = [];
            var pending = 0;
            var finished = false;
            var list = (files || []).filter(function (f) {
                return f && f.fullPath && !_shouldSkipPath(f.fullPath);
            }).slice(0, MAX_SEARCH_FILES);

            function maybeDone() {
                if (finished) {
                    return;
                }
                if (pending === 0 || hits.length >= maxHits) {
                    finished = true;
                    deferred.resolve(JSON.stringify({
                        query: q,
                        hits: hits.slice(0, maxHits),
                        scanned_files: list.length
                    }, null, 2));
                }
            }

            if (!list.length) {
                deferred.resolve(JSON.stringify({ query: q, hits: [], scanned_files: 0 }));
                return;
            }

            list.forEach(function (file) {
                if (hits.length >= maxHits) {
                    return;
                }
                pending++;
                file.read(function (err, data) {
                    pending--;
                    if (!err && typeof data === "string" && hits.length < maxHits) {
                        var lines = data.split(/\r?\n/);
                        var rel = FileUtils.getRelativeFilename(_rootPath(), file.fullPath) || file.name;
                        for (var i = 0; i < lines.length && hits.length < maxHits; i++) {
                            if (lines[i].toLowerCase().indexOf(qLower) !== -1) {
                                hits.push({
                                    path: rel.replace(/\\/g, "/"),
                                    line: i + 1,
                                    text: lines[i].trim().slice(0, 200)
                                });
                            }
                        }
                    }
                    maybeDone();
                });
            });
        }).fail(function (err) {
            deferred.resolve(JSON.stringify({ error: String(err) }));
        });

        return deferred.promise();
    }

    /**
     * Validate write target; does not write — caller handles Accept/Reject.
     */
    function propose_write(args) {
        var deferred = new $.Deferred();
        var resolved = resolveInProject(args && args.path);
        if (!resolved.ok) {
            deferred.resolve({ error: resolved.error });
            return deferred.promise();
        }
        if (!args || typeof args.content !== "string") {
            deferred.resolve({ error: "content (string) requis" });
            return deferred.promise();
        }
        if (!args.path || args.path === ".") {
            deferred.resolve({ error: "path fichier requis" });
            return deferred.promise();
        }

        var file = FileSystem.getFileForPath(resolved.abs);
        file.read(function (err, data) {
            deferred.resolve({
                path: resolved.rel,
                abs: resolved.abs,
                content: args.content,
                previous: err ? null : String(data || ""),
                isNew: !!err
            });
        });
        return deferred.promise();
    }

    function apply_write(absPath, content) {
        var deferred = new $.Deferred();
        var file = FileSystem.getFileForPath(absPath);
        file.write(content, function (err) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(absPath);
            }
        });
        return deferred.promise();
    }

    var TOOL_DEFS = [
        {
            name: "list_dir",
            description: "Liste fichiers/dossiers sous un chemin relatif au projet (défaut: .)",
            parameters: { path: "string (relatif)" }
        },
        {
            name: "read_file",
            description: "Lit un fichier texte du projet (tronqué si trop long)",
            parameters: { path: "string (relatif)" }
        },
        {
            name: "search_text",
            description: "Recherche une sous-chaîne dans les fichiers du projet",
            parameters: { query: "string", max_results: "number optionnel" }
        },
        {
            name: "write_file",
            description: "Propose une écriture fichier (l’utilisateur doit Accept/Reject)",
            parameters: { path: "string", content: "string contenu complet" }
        }
    ];

    function runTool(name, args) {
        if (name === "list_dir") {
            return list_dir(args || {});
        }
        if (name === "read_file") {
            return read_file(args || {});
        }
        if (name === "search_text") {
            return search_text(args || {});
        }
        if (name === "write_file") {
            return propose_write(args || {});
        }
        var d = new $.Deferred();
        d.resolve(JSON.stringify({ error: "Outil inconnu: " + name }));
        return d.promise();
    }

    function systemToolsBlurb() {
        return (
            "Tu disposes d’outils projet. Pour les appeler, réponds UNIQUEMENT avec un bloc:\n" +
            "```tool\n" +
            "{\"name\":\"list_dir\",\"arguments\":{\"path\":\".\"}}\n" +
            "```\n" +
            "Outils: " + TOOL_DEFS.map(function (t) { return t.name; }).join(", ") + ".\n" +
            "Après un résultat d’outil, continue. Pour la réponse finale à l’utilisateur, " +
            "texte normal sans bloc tool. write_file propose un patch (Accept/Reject humain)."
        );
    }

    /**
     * Extract first ```tool ... ``` JSON payload from model text.
     * @return {{name:string, arguments:Object}|null}
     */
    function parseToolCall(text) {
        if (!text) {
            return null;
        }
        var m = String(text).match(/```tool\s*([\s\S]*?)```/i);
        if (!m) {
            // also accept bare JSON tool call line
            m = String(text).match(/^\s*(\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*\}\s*\})\s*$/);
            if (!m) {
                return null;
            }
            try {
                var bare = JSON.parse(m[1]);
                if (bare && bare.name) {
                    return { name: bare.name, arguments: bare.arguments || {} };
                }
            } catch (e1) {
                return null;
            }
            return null;
        }
        try {
            var obj = JSON.parse(m[1].trim());
            if (obj && obj.name) {
                return { name: obj.name, arguments: obj.arguments || {} };
            }
        } catch (e2) {
            return null;
        }
        return null;
    }

    exports.resolveInProject = resolveInProject;
    exports.runTool = runTool;
    exports.apply_write = apply_write;
    exports.parseToolCall = parseToolCall;
    exports.systemToolsBlurb = systemToolsBlurb;
    exports.TOOL_DEFS = TOOL_DEFS;
});
