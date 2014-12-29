/*jshint expr:true */
/*jshint evil:true */

'use strict';

var should = require('should');

var nodePhantomMock = require("./mocks").nodePhantomMock;

var boxtreeModule = require("../src/boxtree"),
	Boxtree = boxtreeModule.Boxtree,
	pagePoolSize = 3,
	boxtree;

var beforeAllFunc = function() {
	boxtreeModule.mock( nodePhantomMock );
};
var beforeEachFunc = function(done) {
	boxtree = new Boxtree(
		null,
		pagePoolSize
	);
	boxtree.init( function() {
		done();
	} );
};
var afterEachFunc = function(done) {
	if ( !boxtree.isBeingFinalized ) {
		boxtree.finalize( function() {
			done();
		} );
	} else {
		done();
	}
};
var afterAllFunc = function() {
	boxtreeModule.cleanMock();
};

describe( "boxtree", function(){
	before( beforeAllFunc );
	after( afterAllFunc );
	describe( "module init", function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "boxtree should have the right size of page pool", function(done) {
			// wait for fully loaded boxtree
			setTimeout( function() {
				boxtree.pagePool.length.should.equal( pagePoolSize );
				done();
			}, 10 );
		} );
	} );
	describe( "bucket initialization", function() {
		it( "should produce a single bucket when poolSize is 1", function() {
			var boxtree = new Boxtree(
				null,
				1
			);
			boxtree.buckets.should.be.eql( [ 1 ] );
		} );
		it( "should produce two buckets with size 1 each, when poolSize is 2 and bucketsCount is default (2)", function() {
			var boxtree = new Boxtree(
				null,
				2
			);
			boxtree.buckets.should.be.eql( [ 1, 1 ] );
		} );
		it( "should produce two buckets with size 5 each, when poolSize is 10 and bucketsCount is default (2)", function() {
			var boxtree = new Boxtree(
				null,
				10
			);
			boxtree.buckets.should.be.eql( [ 5, 5 ] );
		} );
		it( "should produce two buckets with sizes 6 and 5, when poolSize is 11 and bucketsCount is default (2)", function() {
			var boxtree = new Boxtree(
				null,
				11
			);
			boxtree.buckets.should.be.eql( [ 6, 5 ] );
		} );
		it( "should work in big number example", function() {
			var boxtree = new Boxtree(
				null,
				1111,
				5
			);
			boxtree.buckets.should.be.eql( [ 223, 222, 222, 222, 222 ] );
		} );
	} );
	describe( "bucket recycling", function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "replaces full buckets with new ones", function(done) {
			var initialBucket1 = boxtree.buckets[0],
				initialBucket2 = boxtree.buckets[1];
			// 3
			boxtree.getPage( function(page1) {
				// 2
				boxtree.getPage( function(page2) {
					// 1
					boxtree.getPage( function(page3) {
						// 0 pages left
						boxtree.getPage( function() {
							var bucket1 = boxtree.buckets[0],
								bucket2 = boxtree.buckets[1],
								equalCount = 0;
							if ( initialBucket1 === bucket1 ) {
								equalCount++;
							}
							if ( initialBucket2 === bucket2 ) {
								equalCount++;
							}
							// at least one bucket should be recycled by now
							equalCount.should.not.equal( 2 );
							done();
						} );
						boxtree.recyclePage( page1 );
						boxtree.recyclePage( page2 );
						boxtree.recyclePage( page3 );
					} );
				} );
			} );
		} );
	} );
	describe( "reserveBox", function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "decreases the count of pages in the pool", function(done) {
			// wait for fully loaded boxtree
			setTimeout( function() {
				boxtree.reserveBox( function() {
					boxtree.pagePool.length.should.equal( pagePoolSize - 1 );
					boxtree.reserveBox( function() {
						boxtree.pagePool.length.should.equal( pagePoolSize - 2 );
						done();
					} );
				} );
			}, 10 );
		} );
		it( "increases the number of runnging instances logged in the runningPool", function(done) {
			boxtree.reserveBox( function() {
				boxtree.runningPool.length.should.equal( 1 );
				boxtree.reserveBox( function() {
					boxtree.runningPool.length.should.equal( 2 );
					done();
				} );
			} );
		} );
		it( "starts filling the reservationQueue when no pages are left", function(done) {
			// 3
			boxtree.reserveBox( function() {
				// 2
				boxtree.reserveBox( function() {
					// 1
					boxtree.reserveBox( function() {
						// 0
						boxtree.reserveBox( function() {
							// this is in the queue
						} );
						boxtree.pagePool.length.should.equal( 0 );
						boxtree.reservationQueue.length.should.equal( 1 );
						done();
					} );
				} );
			} );
		} );
		it( "no-longer grows the runningPool after no pages are left", function(done) {
			// 3
			boxtree.reserveBox( function() {
				// 2
				boxtree.reserveBox( function() {
					// 1
					boxtree.reserveBox( function() {
						// 0
						boxtree.runningPool.length.should.equal( 3 );
						boxtree.reserveBox( function() {
							// this is in the queue
						} );
						boxtree.runningPool.length.should.equal( 3 );
						boxtree.pagePool.length.should.equal( 0 );
						boxtree.reservationQueue.length.should.equal( 1 );
						done();
					} );
				} );
			} );
		} );
	} );
	describe( "releaseBox", function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "adds to .forRecycle prop of the relevant bucket when box is released", function(done) {
			boxtree.reserveBox( function(boxToRelease) {
				var bucketId = boxToRelease.page._boxtree_bucketId,
					bucket = boxtree.buckets[bucketId],
					previousCount = bucket.forRecycle.length;

				boxtree.releaseBox( boxToRelease );
				bucket.forRecycle.length.should.equal( previousCount + 1 );
				done();
			} );
		} );
		it( "executes callback in the reservation queue when bucket.forRecycle is filled", function(done) {
			// 3
			boxtree.reserveBox( function(box1) {
				// 2
				boxtree.reserveBox( function(box2) {
					// 1
					boxtree.reserveBox( function(box3) {
						// 0
						boxtree.reserveBox( function(box) {
							should.exist( box );
							boxtree.pagePool.length.should.equal( 0 );
							done();
						} );
						boxtree.releaseBox( box1 );
						boxtree.releaseBox( box2 );
						boxtree.releaseBox( box3 );
					} );
				} );
			} );
		} );
		it( "executes callbacks in the reservation queue in FIFO order", function(done) {
			var callbacksCalled = 0;
			// 3
			boxtree.reserveBox( function(box1) {
				// 2
				boxtree.reserveBox( function(box2) {
					// 1
					boxtree.reserveBox( function(box3) {
						// 0
						boxtree.reserveBox( function() {
							callbacksCalled.should.equal( 0 );
							callbacksCalled++;
						} );
						boxtree.reserveBox( function() {
							callbacksCalled.should.equal( 1 );
							callbacksCalled++;
							done();
						} );
						boxtree.releaseBox( box1 );
						boxtree.releaseBox( box2 );
						boxtree.releaseBox( box3 );
					} );
				} );
			} );
		} );
		it( "doesn't throw error if boxtree is being finalized", function(done) {
			boxtree.reserveBox( function(box1) {
				should( function() {
					boxtree.finalize( done );
					boxtree.releaseBox( box1 );
				} ).not.throw();
			} );
		} );
	} );
	describe( "getPage", function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "gets from the count of the pagePool", function(done) {
			// wait for fully loaded boxtree
			setTimeout( function() {
				boxtree.getPage( function() {
					boxtree.pagePool.length.should.equal( pagePoolSize - 1 );
					boxtree.getPage( function() {
						boxtree.pagePool.length.should.equal( pagePoolSize - 2 );
						done();
					} );
				} );
			}, 10 );
		} );
		it( "doesn't increase the runningPool's count", function(done) {
			boxtree.getPage( function() {
				boxtree.runningPool.length.should.equal( 0 );
				boxtree.getPage( function() {
					boxtree.runningPool.length.should.equal( 0 );
					done();
				} );
			} );
		} );
		it( "starts filling the getPageQueue when no pages are left", function(done) {
			// 3
			boxtree.getPage( function() {
				// 2
				boxtree.getPage( function() {
					// 1
					boxtree.getPage( function() {
						// 0
						boxtree.getPage( function() {
							// this is in the queue
						} );
						boxtree.pagePool.length.should.equal( 0 );
						boxtree.getPageQueue.length.should.equal( 1 );
						done();
					} );
				} );
			} );
		} );
	} );
	describe( "recyclePage", function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "adds to .forRecycle prop of the relevant bucket when box is released", function(done) {
			boxtree.getPage( function(page) {
				var bucketId = page._boxtree_bucketId,
					bucket = boxtree.buckets[bucketId],
					previousCount = bucket.forRecycle.length;

				boxtree.recyclePage( page );
				bucket.forRecycle.length.should.equal( previousCount + 1 );
				done();
			} );
		} );
		it( "executes callback in the reservation queue when bucket.forRecycle is filled", function(done) {
			// 3
			boxtree.getPage( function(page1) {
				// 2
				boxtree.getPage( function(page2) {
					// 1
					boxtree.getPage( function(page3) {
						// 0
						boxtree.reserveBox( function(box) {
							should.exist( box );
							boxtree.pagePool.length.should.equal( 0 );
							done();
						} );
						boxtree.recyclePage( page1 );
						boxtree.recyclePage( page2 );
						boxtree.recyclePage( page3 );
					} );
				} );
			} );
		} );
		it( "executes callback in the getPageQueue when bucket.forRecycle is filled", function(done) {
			// 3
			boxtree.getPage( function(page1) {
				// 2
				boxtree.getPage( function(page2) {
					// 1
					boxtree.getPage( function(page3) {
						// 0
						boxtree.getPage( function(page) {
							should.exist( page );
							boxtree.pagePool.length.should.equal( 0 );
							done();
						} );
						boxtree.recyclePage( page1 );
						boxtree.recyclePage( page2 );
						boxtree.recyclePage( page3 );
					} );
				} );
			} );
		} );
		it( "executes callbacks in the reservation queue in FIFO order", function(done) {
			var callbacksCalled = 0;
			// 3
			boxtree.getPage( function(page1) {
				// 2
				boxtree.getPage( function(page2) {
					// 1
					boxtree.getPage( function(page3) {
						// 0
						boxtree.reserveBox( function() {
							callbacksCalled.should.equal( 0 );
							callbacksCalled++;
						} );
						boxtree.reserveBox( function() {
							callbacksCalled.should.equal( 1 );
							callbacksCalled++;
							done();
						} );
						boxtree.recyclePage( page1 );
						boxtree.recyclePage( page2 );
						boxtree.recyclePage( page3 );
					} );
				} );
			} );
		} );
		it( "doesn't throw error if boxtree is being finalized", function(done) {
			boxtree.reserveBox( function(box1) {
				should( function() {
					boxtree.finalize( done );
					boxtree.recyclePage( box1.page );
				} ).not.throw();
			} );
		} );
	} );
	describe( "phantom complete crash handling", function() {
		beforeEach( beforeEachFunc );
		afterEach( afterEachFunc );
		it( "recycles crashed phantom", function(done) {
			var bucket = boxtree.buckets[0];
			// 3
			boxtree.reserveBox( function() {
				// 2
				boxtree.reserveBox( function() {
					// 1
					boxtree.reserveBox( function() {
						// 0 pages left
						boxtree.reserveBox( function() {
							// only after recycle will this be executed
							done();
						} );
						// simulate crash
						bucket.phantom._phantom.stderr.emit( "data" );
					} );
				} );
			} );
		} );
		it( "throws a system error", function(done) {
			var bucket1 = boxtree.buckets[0],
				bucket2 = boxtree.buckets[1];
			// 3
			boxtree.reserveBox( function() {
				// 2
				boxtree.reserveBox( function() {
					// 1
					boxtree.reserveBox( function(box) {
						box.on( "error", function(error) {
							should.exist( error );
							error.type.should.equal( "systemError" );
							done();
						} );
						// simulate crash on all buckets (no way to
						// be sure on which bucket the last box belongs)
						bucket1.phantom._phantom.stderr.emit( "data" );
						bucket2.phantom._phantom.stderr.emit( "data" );
					} );
				} );
			} );
		} );
		it( "recycles only the associated to the crashed phantom pages", function(done) {
			// get the bucket with size = 2 (the other is with size = 1)
			var bucket = boxtree.buckets[0].size === 2 ? boxtree.buckets[0] : boxtree.buckets[1];
			// 3
			boxtree.reserveBox( function() {
				// 2
				boxtree.reserveBox( function() {
					// 1
					boxtree.reserveBox( function() {
						// 0
						var isWrongPageRecycled = false,
							original = boxtree.recyclePage;

						boxtree.recyclePage = function(page) {
							if ( page._boxtree_bucketId !== bucket.id ) {
								isWrongPageRecycled = true;
							}
							original.apply( boxtree, arguments );
						};
						bucket.phantom._phantom.stderr.emit( "data" );
						isWrongPageRecycled.should.not.be.ok;
						done();
					} );
				} );
			} );
		} );
		it( "doesn't break when box is being reset", function(done) {
			// get the bucket with size = 2 (the other is with size = 1)
			var bucket = boxtree.buckets[0].size === 2 ? boxtree.buckets[0] : boxtree.buckets[1];
			// 3
			boxtree.reserveBox( function() {
				// 2
				boxtree.reserveBox( function() {
					// 1
					boxtree.reserveBox( function(box) {
						// 0
						box.reset();
						should( function() {
							bucket.phantom._phantom.stderr.emit( "data" );
						} ).not.throw();
						done();
					} );
				} );
			} );
		} );
		it( "doesn't break when boxtree is being finalized", function(done) {
			var bucket = boxtree.buckets[0];

			boxtree.reserveBox( function() {
				boxtree.finalize( function() {
					should( function() {
						bucket.phantom._phantom.stderr.emit( "data" );
					} ).not.throw();
					done();
				} );
			} );
		} );
		it( "recycles pagePool pages and removes them from pagePool", function(done) {
			setTimeout( function() {
				// get the bucket with size = 2 (the other is with size = 1)
				var bucket = boxtree.buckets[0].size === 2 ? boxtree.buckets[0] : boxtree.buckets[1];
				bucket.phantom._phantom.stderr.emit( "data" );
				boxtree.pagePool.length.should.equal( 1 );
				done();
			}, 10 );
		} );
		it( "sets the reset bucket (after crash) in the buckets array, before initializing all pages", function(done) {
			var isDone = false;
			var onError = function(box) {
				if ( !isDone ) {
					should( function() {
						boxtree.releaseBox( box );
					} ).not.throw();
					isDone = true;
					done();
				}
			};
			boxtree.reserveBox( function(box) {
				box.on( "error", function() {
					onError( box );
				} );
				boxtree.reserveBox( function(box) {
					box.on( "error", function() {
						onError( box );
					} );
					boxtree.reserveBox( function(box) {
						box.on( "error", function() {
							onError( box );
						} );
						// crash the larger bucket
						var bucket = boxtree.buckets[0].size === 2 ? boxtree.buckets[0] : boxtree.buckets[1];
						bucket.phantom._phantom.stderr.emit( "data" );
					} );
				} );
			} );
		} );
	} );
} );