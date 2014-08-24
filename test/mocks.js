/* jshint -W030 */

'use strict';

function PageMock() {

}
PageMock.prototype = {

	open: function(url, callback) {
		callback( null, "success" );
	},

	evaluate: function(func, callback) {
		callback();
	}

};

function PhantomMock() {
	var self = this;

	self._phantom = {
		stderr: {
			_handlers: {},
			on: function(eventName, callback) {
				var self = this;
				self._handlers[ eventName ] = callback;
			},
			emit: function(eventName) {
				var self = this,
					callback = self._handlers[ eventName ];
				if ( callback ) {
					callback();
				}
			},
			removeListener: function() {}
		}
	};
}
PhantomMock.prototype = {

	_phantom: null,

	createPage: function(callback) {
		setTimeout( function() {
			callback( null, new PageMock() );
		}, 1 );
	},

	exit: function(callback) {
		callback && setTimeout( function() {
			callback();
		}, 1 );
	}

};

exports.nodePhantomMock = {

	create: function(callback) {
		callback( null, new PhantomMock() );
	}

};