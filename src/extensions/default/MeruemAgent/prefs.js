/*
 * Meruem Agent LLM preferences (local-first).
 */

define(function (require, exports, module) {
    "use strict";

    var PreferencesManager = brackets.getModule("preferences/PreferencesManager"),
        llm                = require("./llm");

    var prefs = PreferencesManager.getExtensionPrefs("meruemAgent");

    prefs.definePreference("provider", "string", "ollama", {
        description: "LLM provider preset: ollama | lmstudio | custom"
    });
    prefs.definePreference("baseUrl", "string", llm.PRESETS.ollama.baseUrl, {
        description: "OpenAI-compatible base URL (…/v1)"
    });
    prefs.definePreference("model", "string", llm.PRESETS.ollama.model, {
        description: "Model id for /v1/chat/completions"
    });
    prefs.definePreference("apiKey", "string", "local", {
        description: "API key (often unused locally; default 'local')"
    });

    function applyProviderPreset(provider) {
        var preset = llm.PRESETS[provider] || llm.PRESETS.ollama;
        prefs.set("provider", provider);
        prefs.set("baseUrl", preset.baseUrl);
        prefs.set("model", preset.model);
        prefs.save();
    }

    function getConfig() {
        return {
            provider: prefs.get("provider") || "ollama",
            baseUrl: prefs.get("baseUrl") || llm.PRESETS.ollama.baseUrl,
            model: prefs.get("model") || llm.PRESETS.ollama.model,
            apiKey: prefs.get("apiKey") || "local"
        };
    }

    function statusLabel(config) {
        var preset = llm.PRESETS[config.provider];
        var name = preset ? preset.label : config.provider;
        return name + " · " + config.model;
    }

    exports.prefs = prefs;
    exports.applyProviderPreset = applyProviderPreset;
    exports.getConfig = getConfig;
    exports.statusLabel = statusLabel;
});
