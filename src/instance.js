/*jshint evil:true */

'use strict';

var util = require("util"),
	EventEmitter = require("events").EventEmitter;

// Debug:
var DEBUG = false;

// CONSTS
var DEFAULT_RUN_TIME = DEBUG ? 500000 : 5000;

function Instance(boxtree, clientScript, page) {
	var self = this;

	self.boxtree = boxtree;
	self.clientScript = clientScript;
	self.page = null;
	self.url = null;
	self.scripts = [];
	self.isFinished = false;
	self.isBeingReset = false;
	self.clock = null;
	self.taskRunTime = DEFAULT_RUN_TIME;

	EventEmitter.call( self );

	if ( !page ) {
		throw new Error( "Boxtree instance can't be created without a page" );
	}

	self._bindToPage( page );
}

util.inherits( Instance, EventEmitter );

Instance.prototype.addScript = function(script) {
	var self = this;
	self.scripts.push( script );
	return self;
};

Instance.prototype.setUrl = function(url) {
	var self = this;
	self.url = url;
	return self;
};

Instance.prototype.run = function(timeout) {
	var self = this,
		page = self.page,
		url = self.url,
		scripts = self.scripts.slice();

	self._startClock( timeout );

	var asyncWhile = function() {
		if ( scripts.length > 0 ) {
			var script = scripts.splice( 0, 1 )[0],
				toEvaluate;
			try {
				toEvaluate = eval( [
					"(function() {",
						script,
					"});"
				].join( "\n" ) );
			} catch(e) {
				toEvaluate = null;
			}
			if ( !toEvaluate ) {
				self.reset( function() {
					self.emit( "error", {
						type: "invalidJavaScript",
						message: "Error loading script: " + script
					} );
				} );
				return;
			}
			page.evaluate( toEvaluate, function(error) {
				if ( error ) {
					self.reset( function() {
						self.emit( "error", {
							type: "pageEvaluate",
							message: "Error loading script: " + script
						} );
					} );
				} else {
					asyncWhile();
				}
			} );
		}
	};

	if ( url ) {
		page.open( url, function(error, status) {
			if ( status !== "success" ) {
				self.reset( function() {
					self.emit( "error", {
						type: "navigation",
						message: "Error loading url: " + url
					} );
				} );
				return;
			}
			page.evaluate( eval( "( function() {" + self.clientScript + "})" ), function(err) {
				if ( err ) {
					throw new Error( "Error on client script injection: tried to inject after navigation to: " + url );
				}
				asyncWhile();
			} );
		} );
	} else {
		asyncWhile();
	}
	return self;
};

Instance.prototype.cleanScripts = function() {
	var self = this;
	self.scripts = [];
	return self;
};

Instance.prototype.reset = function(callback) {
	var self = this,
		boxtree = self.boxtree,
		page = self.page;

	self.isBeingReset = true;

	self._unbindFromPage();
	self._clearClock();

	boxtree.recyclePage( page );
	boxtree.getPage( function(page) {
		self.isBeingReset = false;
		if ( self.isFinished ) {
			boxtree.recyclePage( page );
		} else {
			self._bindToPage( page );
			if ( callback ) {
				callback();
			}
		}
	} );
};

Instance.prototype.finalize = function() {
	var self = this;

	if ( !self.isFinished ) {
		if ( !self.isBeingReset ) {
			self._unbindFromPage();
		}
		self.isFinished = true;
		self.removeAllListeners();
	}
};

Instance.prototype._bindToPage = function(page) {
	var self = this;

	self.page = page;
	page.onCallback = function(args) {
		var action = args.actionName;
		if ( action.indexOf( "method_" ) === 0 ) {
			var methodName = action.replace( /method/, "" );
			if ( self[ methodName ] ) {
				self[ methodName ]( args.args );
			}
		} else if ( action.indexOf( "event_" ) === 0 ) {
			self.emit( action.replace(/event_/, ""), args.args );
		} else if ( action === "error_runtime" ) {
			self.reset( function() {
				self.emit( "error", args.args );
			} );
		} else {
			self.emit( action, args.args );
		}
	};
	page.onConsoleMessage = function(message) {
		console.log( "Instance message: " + message );
	};
};

Instance.prototype._unbindFromPage = function() {
	var self = this;

	// if set to null node-phantom breaks with "object is not a funciton"
	self.page.onCallback = function() {};
	self.page.onConsoleMessage =  function() {};
	self.page = null;
};

Instance.prototype._startClock = function(timeout) {
	var self = this;
	self.clock = setTimeout( function() {
		if ( !self.isFinished ) {
			self.reset( function() {
				self.emit( "error", {
					type: "timeout",
					message: "Boxtree instance has timed-out."
				} );
			} );
		}
	}, timeout || DEFAULT_RUN_TIME );
};

Instance.prototype._clearClock = function() {
	var self = this,
		clock = self.clock;
	if ( clock ) {
		clearTimeout( clock );
	}
};

Instance.prototype._spawnTask = function(args) {
	var self = this,
		originalPage = self.page;
	self.boxtree.reserveBox( function(box) {

		box.setUrl( args.url )
			.addScript( [
				"(function() {",
					"boxApi.setCallbackId( " + args.id + " );",
				"})();"
			].join( "\n" ) )
			.addScript( args.script )
			.on( "callback_" + args.id, function(result) {
				if ( !self.isFinished && !self.isBeingReset && ( self.page === originalPage ) ) {
					self._injectTaskResult( args.id, null, result );
				}
				self.boxtree.releaseBox( box );
			} )
			.on( "error", function(error) {
				if ( !self.isFinished &&
					!self.isBeingReset &&
					( self.page === originalPage ) &&
					!( error.type && error.type === "systemError" ) )
				{
					self._injectTaskResult( args.id, error );
				}
				self.boxtree.releaseBox( box );
			} )
			.run( self.taskRunTime );
	} );
};

Instance.prototype._injectTaskResult = function(id, error, args) {
	var self = this,
		page = self.page,
		errorString = error ? JSON.stringify(error) : "null",
		toEvaluate = eval( [
			"(function() {",
				"boxApi.callback( " + id + ", " + errorString + ", " + JSON.stringify(args) + " );",
			"});"
		].join( "\n" ) );

	page.evaluate( toEvaluate );
};

module.exports = Instance;