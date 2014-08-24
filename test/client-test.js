/*jshint expr:true */
/*jshint evil:true */

'use strict';

var should = require('should'),
	pathUtils = require("path"),
	nodePhantom = require('node-phantom'),
	http = require('http');

var server = http.createServer( function(request,response) {
	response.writeHead( 200, { "Content-Type": "text/html" } );
	response.end( '<html><head></head><body></body></html>' );
} ).listen();

var phantom,
	page;

var beforeAllFunc = function(done) {
	nodePhantom.create( function(error, ph) {
		should.not.exist( error );
		should.exist( ph );
		phantom = ph;
		done();
	} );
};
var beforeEachFunc = function(done) {
	phantom.createPage( function(error, pg) {
		should.not.exist( error );
		should.exist( pg );
		page = pg;
		page.open( "http://localhost:" + server.address().port, function(error, status) {
			should.not.exist( error );
			should.exist( status );
			status.should.equal( "success" );
			page.injectJs( pathUtils.resolve( pathUtils.join( __dirname, "../src/client.js" ) ), function(error) {
				should.not.exist( error );
				done();
			} );
		} );
	} );
};
var afterAllFunc = function(done) {
	phantom.exit( function() {
		done();
	} );
};

describe( 'boxtreeClient', function(){
	this.timeout(3000);
	before( beforeAllFunc );
	describe( 'injecting the script in a phantomjs page', function() {
		beforeEach( beforeEachFunc );
		it( "should create a global boxApi", function(done) {
			page.evaluate( function() {
				return window.boxApi ? true : false;
			}, function(error, result) {
				should.not.exist( error );
				should.exist( result );
				result.should.be.ok;
				done();
			} );
		} );
	} );
	describe( 'setCallbackId', function() {
		beforeEach( beforeEachFunc );
		it( "sets the .callbackId field on the boxApi object", function(done) {
			page.evaluate( function() {
				window.boxApi.setCallbackId( 123 );
				return window.boxApi.callbackId;
			}, function(error, result) {
				should.not.exist( error );
				result.should.be.equal( 123 );
				done();
			} );
		} );
	} );
	describe( 'getNextCallbackId', function() {
		beforeEach( beforeEachFunc );
		it( "gives incremental ids starting from 1", function(done) {
			page.evaluate( function() {
				var ids = [
					window.boxApi.getNextCallbackId(),
					window.boxApi.getNextCallbackId(),
					window.boxApi.getNextCallbackId()
				];
				return ids;
			}, function(error, result) {
				should.not.exist( error );
				result.should.be.eql( [ 1,2,3 ] );
				done();
			} );
		} );
	} );
	describe( 'spawnTask', function() {
		beforeEach( beforeEachFunc );
		it( "calls the other side with method spawnTask, callbackId, script and url", function(done) {
			var expectedScript = "test script",
				expectedId = 1,
				expectedUrl = "http://someurldotcom";

			page.onCallback = function(args) {
				arguments.length.should.be.equal( 1, "onCallback should have 1 argument" );
				should.exist( args );
				args.should.be.eql( {
					actionName: "method_spawnTask",
					args: {
						script: expectedScript,
						id: expectedId,
						url: expectedUrl
					}
				} );
				done();
			};
			page.evaluate( function() {
				window.boxApi.spawnTask( "test script", function() {}, "http://someurldotcom" );
			}, function(error, result) {
				should.not.exist( error );
				should.not.exist( result );
			} );
		} );
	} );
	describe( 'callback', function() {
		beforeEach( beforeEachFunc );
		it( "calls the correct callbacks", function(done) {
			var tasks = [];

			page.onCallback = function(args) {
				tasks.push( args.args.id );
			};
			page.evaluate( function() {
				window.messages = [];
				window.boxApi.spawnTask( "", function(error, result) {
					window.messages.push( "First task finished with error=" + error + ", result=" + result );
				}, "http://someurldotcom" );
				window.boxApi.spawnTask( "", function(error, result) {
					window.messages.push( "Second task finished with error=" + error + ", result=" + result );
				}, "http://someurldotcom" );
			}, function(error, result) {
				should.not.exist( error );
				should.not.exist( result );
				page.evaluate( function(args) {
					// the id's in the opposite order of firing
					window.boxApi.callback( args[0], null, 1 );
					window.boxApi.callback( args[1], "1", 0 );
					return window.messages;
				}, function(error, result) {
					should.not.exist( error );
					should.exist( result );
					result.should.be.eql( [
						"Second task finished with error=null, result=1",
						"First task finished with error=1, result=0"
					] );
					done();
				}, [ tasks[1], tasks[0] ] );
			} );
		} );
	} );
	describe( 'finishTask', function() {
		beforeEach( beforeEachFunc );
		it( "calls with correct callback call and result", function(done) {
			page.onCallback = function(args) {
				args.should.be.eql( {
					actionName: "callback_123",
					args: "result"
				} );
				done();
			};
			page.evaluate( function() {
				window.boxApi.setCallbackId( 123 );
				window.boxApi.finishTask( "result" );
			} );
		} );
	} );
	describe( 'emitEvent', function() {
		beforeEach( beforeEachFunc );
		it( "calls with correct actionName and args", function(done) {
			page.onCallback = function(args) {
				args.should.be.eql( {
					actionName: "event_testEvent",
					args: {
						test: {
							test: "test value"
						}
					}
				} );
				done();
			};
			page.evaluate( function() {
				window.boxApi.emitEvent( "testEvent", {
					test: {
						test: "test value"
					}
				} );
			} );
		} );
		it( "emits errors on script errors on the page", function(done) {
			page.onCallback = function(args) {
				args.actionName.should.equal( "error_runtime" );
				done();
			};
			page.evaluate( function() {
				window.nonExistentFunction();
			} );
		} );
	} );
	after( afterAllFunc );
} );