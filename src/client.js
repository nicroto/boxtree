'use strict';

window.boxApi = {

	id: 1,
	callbacks: {},
	callbackId: null,

	init: function() {
		window.onerror = function(message, file, line) {
			window.callPhantom( {
				actionName: "error_runtime",
				args: {
					type: "runtimeError",
					message: "message: " + message + ", file: " + file + ", line: " + line
				}
			} );
		};
	},

	setCallbackId: function(id) {
		var self = this;
		self.callbackId = id;
	},

	getNextCallbackId: function() {
		var self = this;
		return self.id++;
	},

	spawnTask: function(script, callback, url) {
		var self = this,
			id = self.getNextCallbackId(),
			methodName = "method_spawnTask";

		self.callbacks[ id ] = callback;

		window.callPhantom( {
			actionName: methodName,
			args: {
				script: script,
				id: id,
				url: url
			}
		} );
	},

	callback: function(callbackId, error, result) {
		var self = this,
			callback = self.callbacks[ callbackId ];
		if ( callback ) {
			delete self.callbacks[ callbackId ];
			callback( error, result );
		}
	},

	finishTask: function(result) {
		var self = this,
			callbackId = self.callbackId;

		window.callPhantom( {
			actionName: "callback_" + callbackId,
			args: result
		} );
	},

	emitEvent: function(eventName, args) {
		window.callPhantom( {
			actionName: "event_" + eventName,
			args: args
		} );
	}

};
window.boxApi.init();