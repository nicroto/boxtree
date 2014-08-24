/*jshint expr:true */
/*jshint loopfunc:true */
/* jshint -W034 */

'use strict';

var should = require('should');

// Debug:
var DEBUG = false;

var Boxtree = require("../src/boxtree").Boxtree,
	Instance = require("../src/instance"),
	pagePoolSize = 100,
	boxtree,
	box;

var beforeAllFunc = function(done) {
	boxtree = new Boxtree(
		null,
		pagePoolSize
	);
	boxtree.init( function() {
		done();
	} );
};
var beforeEachFunc = function(done) {
	boxtree.reserveBox( function(b) {
		box = b;
		done();
	} );
};
var afterEachFunc = function() {
	boxtree.releaseBox( box );
};
var afterAllFunc = function() {
	boxtree.finalize();
};

describe( 'Instance', function(){
	this.timeout( DEBUG ? 300000 : 10000 );
	before( beforeAllFunc );
	after( afterAllFunc );
	describe( 'initialState', function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "has boxtree client API injected", function(done) {
			should.exist(box.page);
			box.page.evaluate( function() {
				return window.boxApi ? true : false;
			}, function(error, result) {
				should.not.exist( error );
				should.exist( result );
				result.should.be.ok;
				done();
			} );
		} );
	} );
	describe( 'addScript', function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "adds scripts to scripts array prop", function() {
			var script = "test";
			box.addScript( script );
			should.exist( box.scripts );
			box.scripts.length.should.equal( 1 );
			box.scripts[0].should.equal( script );
		} );
	} );
	describe( 'setUrl', function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "sets the url prop", function() {
			var url = "test";
			box.setUrl( url );
			should.exist( box.url );
			box.url.should.equal( url );
		} );
	} );
	describe( 'cleanScripts', function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "replaces the .scripts array with empty array", function() {
			var script = "console.log('dummy script');";
			box.addScript( script );
			should.exist( box.scripts );
			box.scripts.length.should.equal( 1 );

			box.cleanScripts();

			should.exist( box.scripts );
			box.scripts.should.be.empty;
		} );
	} );
	describe( 'run', function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "injects scripts in the correct order", function(done) {
			var script1 = "window.messages = [ 1 ];";
			var script2 = "window.messages.push( 2 );";
			var script3 = "window.messages.push( 3 );";
			var script4 = "window.boxApi.emitEvent( 'result', window.messages );";
			var expectedArray = [ 1, 2, 3 ];
			box.addScript( script1 )
				.addScript( script2 )
				.addScript( script3 )
				.addScript( script4 )
				.on( "result", function(result) {
					should.exist( result );
					result.should.eql( expectedArray );
					done();
				} )
				.run();
		} );
		it( "emits timeout error if running for too long", function(done) {
			var script = function() {
				setTimeout( function() {
					window.boxApi.emitEvent( "finish" );
				}, 1000 );
			};
			box.addScript( "(" + script + ")();" )
				.on( "error", function(error) {
					should.exist( error );
					error.type.should.equal( "timeout" );
					done();
				} )
				.run(30);
		} );
		it( "emits invalidScript error if invalid javascript is passed", function(done) {
			// 1 double-quote marks the beginning of a string, but without a closing one
			// on the same line = invalid javascript
			var script = "\"";
			box.addScript( script )
				.on( "error", function(error) {
					should.exist( error );
					error.type.should.equal( "invalidJavaScript" );
					done();
				} )
				.run();
		} );
		it( "emits scriptError if valid javascript produces error during execution", function(done) {
			var script = "nonExistentFunction();";
			box.addScript( script )
				.on( "error", function(error) {
					should.exist( error );
					error.type.should.equal( "runtimeError" );
					done();
				} )
				.run();
		} );
		it( "emits navigation error if instance is not able to navigate to set url", function(done) {
			var script = "console.log('it will never run this line');";
			box.addScript( script )
				.setUrl("http://tsenkovaasdasdasdasdasdasd.net")
				.on( "error", function(error) {
					should.exist( error );
					error.type.should.equal( "navigation" );
					done();
				} )
				.run();
		} );
	} );
	describe( 'reset', function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "resets the page of the instance", function(done) {
			var initialPage = box.page;
			box.reset( function() {
				should.exist( box.page );
				initialPage.should.not.equal( box.page );
				done();
			} );
		} );
		it( "prevents errors from the original page to be emitted", function(done) {
			var emitted = false;
			box
				.addScript( "crashThis();" )
				.on( "error", function() {
					emitted = true;
				} )
				.run()
				.reset();
			setTimeout( function() {
				emitted.should.not.be.ok;
				done();
			}, 10 );
		} );
		it( "preserves instance usability", function(done) {
			var isResetCallbackCalled = false;
			box
				.addScript( "setTimeout( function() { window.boxApi.emitEvent( 'finish' ); }, 100 );" )
				.on( "finish", function() {
					isResetCallbackCalled.should.be.ok;
					done();
				} )
				.run()
				.reset( function() {
					isResetCallbackCalled = true;
					box.run();
				} );
		} );
		it( "recycles the fresh page if the box is released and doesn't call-back", function(done) {
			var boxtreeMock = {
					_recycledPages: [],

					recyclePage: function(page) {
						var self = this;
						self._recycledPages.push( page );
					},

					getPage: function(callback) {
						setTimeout( function() {
							var pageMock = {};
							callback( pageMock );
						}, 1 );
					}
				},
				box = new Instance( boxtreeMock, null, {} );

			box
				.on( "finish", function() {
					// if called, this will break
					false.should.be.ok;
				} )
				.run()
				.reset( function() {
					false.should.be.ok;
				} );
			box.finalize();
			setTimeout( function() {
				// should be 2, because on reset, the initial page is
				// recycled, and after it gets a new one - it resets
				// that too
				boxtreeMock._recycledPages.length.should.equal( 2 );
				done();
			}, 1 );
		} );
	} );
	describe( 'finalize', function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "close the page", function() {
			box.finalize();
			should.not.exist( box.page );
		} );
		it( "sets isFinished prop to true", function() {
			box.finalize();
			box.isFinished.should.be.ok;
		} );
		it( "removes all event listeners", function() {
			var called = false;
			box.on ( "finish", function() {
				called = true;
			} );

			box.finalize();
			box.emit( "finish" );

			called.should.not.be.ok;
		} );
	} );
	describe( 'spawning tasks', function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "successfully spawns a synchronous script", function(done) {
			var script = function() {
				var script = function() {
					window.boxApi.finishTask( 2 + 2 );
				};
				window.boxApi.spawnTask( "(" + script + ")();", function(error, result) {
					if ( !error && result === 4 ) {
						window.boxApi.emitEvent( "finish", true );
					}
				} );
			};
			box.addScript(  "(" + script + ")();" )
				.on( "finish", function(result) {
					result.should.be.ok;
					done();
				} )
				.run();
		} );
		it( "successfully spawns a synchronous script on a specified url", function(done) {
			var script = function() {
				var script = function() {
					window.boxApi.finishTask( 2 + 2 );
				};
				window.boxApi.spawnTask( "(" + script + ")();", function(error, result) {
					if ( !error && result === 4 ) {
						window.boxApi.emitEvent( "finish", true );
					}
				}, "about:blank" );
			};
			box.addScript(  "(" + script + ")();" )
				.on( "finish", function(result) {
					result.should.be.ok;
					done();
				} )
				.run();
		} );
		it( "successfully spawns an asynchronous script", function(done) {
			var script = function() {
				var script = function() {
					setTimeout( function() {
						window.boxApi.finishTask( 2 + 2 );
					}, 1 );
				};
				window.boxApi.spawnTask( "(" + script + ")();", function(error, result) {
					if ( !error && result === 4 ) {
						window.boxApi.emitEvent( "finish", true );
					}
				} );
			};
			box.addScript(  "(" + script + ")();" )
				.on( "finish", function(result) {
					result.should.be.ok;
					done();
				} )
				.run();
		} );
		it( "successfully spawns an asynchronous script on a specified url", function(done) {
			var script = function() {
				var script = function() {
					setTimeout( function() {
						window.boxApi.finishTask( 2 + 2 );
					}, 1 );
				};
				window.boxApi.spawnTask( "(" + script + ")();", function(error, result) {
					if ( !error && result === 4 ) {
						window.boxApi.emitEvent( "finish", true );
					}
				}, "about:blank" );
			};
			box.addScript(  "(" + script + ")();" )
				.on( "finish", function(result) {
					result.should.be.ok;
					done();
				} )
				.run();
		} );
		it( "successfully delivers navigation error to source of the spawned task", function(done) {
			var script = function() {
				var script = function() {
					boxApi.finishTask( true );
				};
				window.boxApi.spawnTask( "(" + script + ")();", function(error, result) {
					if ( error ) {
						window.boxApi.emitEvent( "finish", false );
					} else if ( result ) {
						//...
					}
				}, "http://tsenkovaasdasdasdasdasdasd.net");
			};
			box.addScript(  "(" + script + ")();" )
				.on( "finish", function(result) {
					result.should.not.be.ok;
					done();
				} )
				.run();
		} );
		it( "successfully delivers navigation error to source of the spawned task real example", function(done) {
			var script = function() {
				'use strict';

				var boxApi = window.boxApi;

				var someLib = window.someLib = {

					query: null,
					options: null,
					max: 0,
					scrapeScript: null,

					init: function(query, options, max, scrapeScript) {
						var self = this;
						self.query = query;
						self.options = options;
						self.max = max;
						self.scrapeScript = scrapeScript;
					},

					getMaxCount: function() {
						var self = this;
						return self.max;
					},

					getQuery: function() {
						var self = this;
						return self.query;
					},

					scrape: function(url, callback) {
						var self = this,
							script = self.scrapeScript;

						boxApi.spawnTask( script, callback, url );
					},

					updateResults: function(results) {
						boxApi.emitEvent( "update", results );
					},

					finishWithError: function( error ) {
						boxApi.emitEvent( "error", error );
					},

					finish: function(results) {
						boxApi.emitEvent( "finish", results );
					}

				};
				someLib.init( "test", [], 200, "'use strict';\n\nvar boxApi = window.boxApi;\n\nwindow.someLib = {\n\n\tfinish: function(result) {\n\t\tboxApi.finishTask( result );\n\t}\n\n};\n/*valid*/someLib.finish( { text: 'test', address: 'http://somthingasdsadasd.com' } );" );
				(function () {
					someLib.scrape( "http://tsenkovasdasdasdasdasd.net", function(error) {
						if ( error ) {
							someLib.finishWithError( error );
							return;
						}
					} );
				})();
			};
			box.addScript(  "(" + script + ")();" )
				.on( "error", function(error) {
					should.exist( error );

					done();
				} )
				.run();
		} );
		it( "successfully delivers scriptError to source of the spawned task", function(done) {
			var script = function() {
				var script = function() {
					window.crashFunciton();
				};
				window.boxApi.spawnTask( "(" + script + ")();", function(error, result) {
					if ( error ) {
						window.boxApi.emitEvent( "finish", false );
					} else if ( result ) {
						//...
					}
				});
			};
			box.addScript(  "(" + script + ")();" )
				.on( "finish", function(result) {
					result.should.not.be.ok;
					done();
				} )
				.run();
		} );
		it( "successfully delivers invalidScript error to source of the spawned task", function(done) {
			var script = function() {
				var script = "\"";
				window.boxApi.spawnTask( "(" + script + ")();", function(error, result) {
					if ( error ) {
						window.boxApi.emitEvent( "finish", false );
					} else if ( result ) {
						//...
					}
				});
			};
			box.addScript(  "(" + script + ")();" )
				.on( "finish", function(result) {
					result.should.not.be.ok;
					done();
				} )
				.run();
		} );
		it( "successfully delivers timeout error to source of the spawned task", function(done) {
			var script = function() {
				var script = function() {
					var timeout = 1000;
					var start = new Date();
					var func = function() {
						setTimeout( function() {
							var end = new Date();
							if ( (end - start) >= timeout ) {
								window.boxApi.finishTask( 2 + 2 );
							} else {
								func();
							}
						}, timeout );
					};
					func();
				};
				window.boxApi.spawnTask( "(" + script + ")();", function(error, result) {
					if ( error ) {
						window.boxApi.emitEvent( "finish", false );
					} else if ( result ) {
						window.boxApi.emitEvent( "finish", true );
					}
				});
			};
			box.taskRunTime = 50;
			box.addScript(  "(" + script + ")();" )
				.on( "finish", function(result) {
					result.should.not.be.ok;
					done();
				} )
				.run();
		} );
		it( "doesn't emit if finalized before recieving task result", function(done) {
			var script = function() {
				var script = function() {
					var timeout = 200;
					var start = new Date();
					var func = function() {
						setTimeout( function() {
							var end = new Date();
							if ( (end - start) >= timeout ) {
								window.boxApi.finishTask( 2 + 2 );
							} else {
								func();
							}
						}, timeout );
					};
					func();
				};
				window.boxApi.spawnTask( script + "", function(error, result) {
					if ( error ) {
						window.boxApi.emitEvent( "finish", false );
					} else if ( result ) {
						window.boxApi.emitEvent( "finish", true );
					}
				});
			};
			var called = false;
			box.taskRunTime = 50;
			box.addScript(  "(" + script + ")();" )
				.on( "finish", function() {
					called = true;
				} )
				.run()
				.finalize();
			setTimeout( function() {
				called.should.not.be.ok;
				done();
			}, 220 );
		} );
		it( "it doesn't callback if reset (on the spawnER) has started and finished when spawned task finished", function(done) {
			var script = function() {
				var script = function() {
					window.boxApi.finishTask();
				};
				window.boxApi.spawnTask( script + "", function() {
					window.boxApi.emitEvent( "finish" );
				});
			};

			var originalSpawnTask = box._spawnTask,
				originalPage = box.page;
			box._spawnTask = function() {
				originalSpawnTask.apply( box, arguments );
				// simulate reset
				box.page = {};
			};

			box
				.addScript(  "(" + script + ")();" )
				.on( "finish", function() {
					// this shouldn't be called
					false.should.be.ok;
				} )
				.run();
			setTimeout( function() {
				// it should've broke by now, if not working correctly

				// clean-up
				box.page = originalPage;
				done();
			}, 30 );
		} );
		it( "it doesn't callback if reset (on the spawnER) has started when spawned task finished", function(done) {
			var script = function() {
				var script = function() {
					window.boxApi.finishTask();
				};
				window.boxApi.spawnTask( script + "", function() {
					window.boxApi.emitEvent( "finish" );
				});
			};

			box.isBeingReset = true;

			box
				.addScript(  "(" + script + ")();" )
				.on( "finish", function() {
					// this shouldn't be called
					false.should.be.ok;
				} )
				.run();
			setTimeout( function() {
				// it should've broke by now, if not working correctly
				done();
			}, 30 );
		} );
	} );
	describe( 'handling load', function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "successfully handles a task with 3 levels of subtasks", function(done) {
			var script = function() {
				var script = function() {
					var script = function() {
						var script = function() {
							window.boxApi.finishTask( 2 + 2 );
						};

						window.boxApi.spawnTask( "(" + script + ")();", function(error, result) {
							if ( !error && result === 4 ) {
								window.boxApi.finishTask( result * 2 );
							}
						} );
					};

					window.boxApi.spawnTask( "(" + script + ")();", function(error, result) {
						if ( !error && result === 8 ) {
							window.boxApi.finishTask( result * 2 );
						}
					} );
				};
				window.boxApi.spawnTask( "(" + script + ")();", function(error, result) {
					if ( !error && result === 16 ) {
						window.boxApi.emitEvent( "finish", true );
					} else {
						window.boxApi.emitEvent( "finish", result );
					}
				} );
			};
			box.addScript(  "(" + script + ")();" )
				.on( "finish", function(result) {
					result.should.equal( true );
					done();
				} )
				.run();
		} );
		it( "successfully handles a task with 9 subtasks (single level)", function(done) {
			var script = function() {
				var asyncCount = 9;
				var script = function() {
					window.boxApi.finishTask( 2 + 2 );
				};

				var result = 0;
				for ( var i = 0; i < 9; i++ ) {
					window.boxApi.spawnTask( "(" + script + ")();", function(error, taskResult) {
						if ( !error ) {
							result += taskResult;
							if ( --asyncCount === 0 ) {
								window.boxApi.emitEvent( "finish", result );
							}
						}
					} );
				}
			};
			box.addScript(  "(" + script + ")();" )
				.on( "finish", function(result) {
					result.should.equal( 9 * 4 );
					done();
				} )
				.run();
		} );
	} );
	describe( 'recovery from errors', function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "executes on time-outed instance", function(done) {
			var script = function() {
				setTimeout( function() {
					window.boxApi.emitEvent( "finish" );
				}, 1000 );
			};
			var script2 = function() {
				var script = function() {
					setTimeout( function() {
						window.boxApi.finishTask( 2 + 2 );
					}, 1 );
				};
				window.boxApi.spawnTask( "(" + script + ")();", function(error, result) {
					if ( !error && result === 4 ) {
						window.boxApi.emitEvent( "finish", true );
					}
				}, "about:blank" );
			};
			box
				.addScript( "(" + script + ")();" )
				.on( "error", function() {
					box
						.cleanScripts()
						.addScript( "(" + script2 + ")();" )
						.on( "finish", function(result) {
							should.exist(result);
							result.should.be.ok;
							done();
						} )
						.run();
				} )
				.run(50);
		} );
		it( "executes on instance which emitted invalidJavaScript error", function(done) {
			// 1 double-quote marks the beginning of a string, but without a closing one
			// on the same line = invalid javascript
			var script = "\"";
			var script2 = function() {
				var script = function() {
					setTimeout( function() {
						window.boxApi.finishTask( 2 + 2 );
					}, 1 );
				};
				window.boxApi.spawnTask( "(" + script + ")();", function(error, result) {
					if ( !error && result === 4 ) {
						window.boxApi.emitEvent( "finish", true );
					}
				}, "about:blank" );
			};
			box
				.addScript( script )
				.on( "error", function() {
					box
						.cleanScripts()
						.addScript( "(" + script2 + ")();" )
						.on( "finish", function(result) {
							should.exist(result);
							result.should.be.ok;
							done();
						} )
						.run();
				} )
				.run();
		} );
		it( "executes on instance which emitted scriptError", function(done) {
			var script = "nonExistentFunction();";
			var script2 = function() {
				var script = function() {
					setTimeout( function() {
						window.boxApi.finishTask( 2 + 2 );
					}, 1 );
				};
				window.boxApi.spawnTask( "(" + script + ")();", function(error, result) {
					if ( !error && result === 4 ) {
						window.boxApi.emitEvent( "finish", true );
					}
				}, "about:blank" );
			};
			box
				.addScript( script )
				.on( "error", function() {
					box
						.cleanScripts()
						.addScript( "(" + script2 + ")();" )
						.on( "finish", function(result) {
							should.exist(result);
							result.should.be.ok;
							done();
						} )
						.run();
				} )
				.run();
		} );
		it( "executes on instance which failed during navigation", function(done) {
			var script = "console.log('it will never run this line');";
			var script2 = function() {
				var script = function() {
					setTimeout( function() {
						window.boxApi.finishTask( 2 + 2 );
					}, 1 );
				};
				window.boxApi.spawnTask( "(" + script + ")();", function(error, result) {
					if ( !error && result === 4 ) {
						window.boxApi.emitEvent( "finish", true );
					}
				}, "about:blank" );
			};
			box
				.addScript( script )
				.setUrl("http://tsenkovaasdasdasdasdasdasd.net")
				.on( "error", function() {
					box
						.setUrl( null )
						.cleanScripts()
						.addScript( "(" + script2 + ")();" )
						.on( "finish", function(result) {
							should.exist(result);
							result.should.be.ok;
							done();
						} )
						.run();
				} )
				.run();
		} );
	} );
} );