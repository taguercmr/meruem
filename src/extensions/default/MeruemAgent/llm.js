/*
 * OpenAI-compatible chat client for local providers (Ollama, LM Studio, custom).
 */

define(function (require, exports, module) {
    "use strict";

    var PRESETS = {
        ollama: {
            label: "Ollama",
            baseUrl: "http://127.0.0.1:11434/v1",
            model: "llama3.2"
        },
        lmstudio: {
            label: "LM Studio",
            baseUrl: "http://127.0.0.1:1234/v1",
            model: "local-model"
        },
        custom: {
            label: "Custom",
            baseUrl: "http://127.0.0.1:11434/v1",
            model: "local-model"
        }
    };

    /**
     * @param {{baseUrl:string, model:string, apiKey?:string, messages:Array, signal?:AbortSignal}} opts
     * @return {$.Promise} resolves to assistant text
     */
    function chatCompletions(opts) {
        var deferred = new $.Deferred();
        var baseUrl = String(opts.baseUrl || "").replace(/\/+$/, "");
        var url = baseUrl + "/chat/completions";
        var body = {
            model: opts.model || "local-model",
            messages: opts.messages || [],
            stream: false
        };
        var headers = {
            "Content-Type": "application/json"
        };
        if (opts.apiKey) {
            headers.Authorization = "Bearer " + opts.apiKey;
        }

        fetch(url, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(body),
            signal: opts.signal
        })
            .then(function (res) {
                return res.text().then(function (raw) {
                    var data = null;
                    try {
                        data = raw ? JSON.parse(raw) : null;
                    } catch (e) {
                        throw new Error("Réponse non JSON (" + res.status + "): " + raw.slice(0, 160));
                    }
                    if (!res.ok) {
                        var errMsg = (data && (data.error && data.error.message || data.error)) || raw.slice(0, 200);
                        throw new Error("HTTP " + res.status + ": " + errMsg);
                    }
                    var content =
                        data &&
                        data.choices &&
                        data.choices[0] &&
                        data.choices[0].message &&
                        data.choices[0].message.content;
                    if (typeof content !== "string") {
                        throw new Error("Pas de contenu assistant dans la réponse");
                    }
                    return content;
                });
            })
            .then(function (text) {
                deferred.resolve(text);
            })
            .catch(function (err) {
                deferred.reject(err);
            });

        return deferred.promise();
    }

    /**
     * Quick connectivity check: GET /models (OpenAI-compatible).
     */
    function listModels(baseUrl, apiKey) {
        var deferred = new $.Deferred();
        var url = String(baseUrl || "").replace(/\/+$/, "") + "/models";
        var headers = {};
        if (apiKey) {
            headers.Authorization = "Bearer " + apiKey;
        }
        fetch(url, { method: "GET", headers: headers })
            .then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) {
                        throw new Error("HTTP " + res.status);
                    }
                    var list = (data && data.data) || [];
                    deferred.resolve(list.map(function (m) { return m.id; }));
                });
            })
            .catch(function (err) {
                deferred.reject(err);
            });
        return deferred.promise();
    }

    exports.PRESETS = PRESETS;
    exports.chatCompletions = chatCompletions;
    exports.listModels = listModels;
});
