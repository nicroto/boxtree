/*jshint evil:true */
/*jshint loopfunc:true */

'use strict';

var pathUtils = require("path"),
	fs = require("fs"),
	nodePhantom = require("node-phantom"),
	clientScript = fs.readFileSync( pathUtils.resolve( pathUtils.join( __dirname, "client.js" ) ), "utf-8" );

var Instance = require("./instance"),
	DEFAULT_BUCKETS_COUNT = 2;


function Boxtree(phantomPath, poolSize, bucketsCount) {
	var self = this;

	if ( !phantomPath ) {
		phantomPath = "/usr/local/bin/phantomjs";
	}
	if ( !poolSize ) {
		throw new Error( "There should be a poolSize argument, which is a positive number > 0" );
	}
	self.phantomPath = phantomPath;
	self.poolSize = poolSize;
	self.buckets = self._getBuckets( poolSize, bucketsCount || DEFAULT_BUCKETS_COUNT )
		.filter( function(item) {
			return item > 0;
		} );

	self.pagePool = [];
	self.runningPool = [];
	self.reservationQueue = [];
	self.getPageQueue = [];
}

Boxtree.prototype = {

	id: 1,
	poolSize: 0,
	buckets: null,
	phantomPath: null,
	pagePool: null,
	runningPool: null,
	reservationQueue: null,
	getPageQueue: null,
	isBeingFinalized: false,


	init: function(callback) {
		var self = this,
			buckets = self.buckets,
			bucketsCount = buckets.length,
			created = 0;

		for ( var i = 0; i < bucketsCount; i++ ) {
			( function() {
			var index = i;
			self._createBucket( buckets[index], index, function(bucket) {
				created++;
				buckets[index] = bucket;
				if ( created === bucketsCount ) {
					callback();
				}
			} );
			} )();
		}
	},

	reserveBox: function(callback) {
		var self = this;

		if ( self.pagePool.length === 0 ) {
			self.reservationQueue.push( callback );
		} else {
			var box = new Instance( self, clientScript, self.pagePool.splice( 0, 1 )[0] );
			self.runningPool.push( box );
			callback( box );
		}
	},

	releaseBox: function( instance ) {
		var self = this,
			page = instance.page;

		if ( !self.isBeingFinalized ) {
			instance.finalize();
			self.runningPool.splice( self.runningPool.indexOf( instance ), 1 );
			self.recyclePage( page );
		}
	},

	getPage: function( callback ) {
		var self = this,
			pool = self.pagePool;

		if ( pool.length === 0 ) {
			self.getPageQueue.push( callback );
		} else {
			callback( pool.splice( 0, 1 )[0] );
		}
	},

	recyclePage: function(page) {
		if ( !page ) {
			return;
		}

		var self = this,
			bucketIndex = page._boxtree_bucketId,
			bucket = self.buckets[ bucketIndex ];

		bucket.forRecycle.push( page );
		if ( bucket.size === bucket.forRecycle.length ) {
			var createNew = function() {
				self._createBucket( bucket.size, bucketIndex, function(newBucket) {
					self.buckets[ bucketIndex ] = newBucket;
				} );
			};
			if ( bucket.hasCrashed ) {
				self._finalizeBucket( bucketIndex );
				createNew();
			} else {
				self._finalizeBucket( bucketIndex, createNew );
			}
		}
	},

	finalize: function(callback) {
		var self = this,
			asyncCount = self.buckets.length;

		self.isBeingFinalized = true;
		for ( var i = 0; i < self.buckets.length; i++ ) {
			( function() {
			var index = i;
			var checkInitialized = function() {
				var bucket = self.buckets[index];
				if ( bucket ) {
					self._finalizeBucket( index, function() {
						if ( --asyncCount === 0 ) {
							if ( callback ) {
								callback();
							}
						}
					} );
				} else {
					setTimeout( function() {
						checkInitialized();
					}, 10 );
				}
			};
			checkInitialized();
			} )();
		}
	},

	_createBucket: function(size, index, callback) {
		var self = this,
			bucket = {
				id: index,
				size: size,
				phantom: null,
				forRecycle: [],
				eventHandlers: {},
				hasCrashed: false
			};

		nodePhantom.create( function(error, ph) {

			if ( error ) {
				throw new Error( "Can't create nodePhantom instance with provided path: " + self.phantomPath );
			}

			bucket.phantom = ph;
			self._bindToPhantomEvents( bucket );

			// this is async and there shouldn't be a reason to wait for it sync
			self._initBucketState( bucket );
			callback( bucket );
		}, {
			parameters: {
				"web-security": "no",
				"ssl-protocol": "any",
				"ignore-ssl-errors": "yes"
			},
			phantomPath: self.phantomPath
		}  );
	},

	_bindToPhantomEvents: function(bucket) {
		var self = this;

		bucket.eventHandlers.stderr_data = function() {
			self._onBucketCrash( bucket );
		};
		bucket.phantom._phantom.stderr.on( 'data', bucket.eventHandlers.stderr_data );
	},

	_unbindFromPhantomEvents: function(bucket) {
		bucket.phantom._phantom.stderr.removeListener( 'data', bucket.eventHandlers.stderr_data );
	},

	_onBucketCrash: function(bucket) {
		// all pages should be returned for recycle
		// this should "naturally" and synchronously
		// trigger bucket recycle
		var self = this,
			pagePool = self.pagePool,
			runningPool = self.runningPool,
			pagePoolCopy = pagePool.slice(),
			runningPoolCopy = runningPool.slice();

		bucket.hasCrashed = true;

		for ( var i = 0; i < pagePoolCopy.length; i++ ) {
			var page = pagePoolCopy[i];
			if ( page._boxtree_bucketId === bucket.id ) {
				self.recyclePage( page );
				pagePool.splice( pagePool.indexOf( page ), 1 );
			}
		}
		for ( i = 0; i < runningPoolCopy.length; i++ ) {
			// closure to keep box reference for every potential reset
			( function() {
			var box = runningPoolCopy[i];
			if ( !box.isBeingReset && box.page._boxtree_bucketId === bucket.id ) {
				// temporarily remove from runningPool
				runningPool.splice( runningPool.indexOf( box ), 1 );
				box.reset( function() {
					// add it back to running pool
					runningPool.push( box );
					if ( box.listeners( "error" ).length ) {
						box.emit( "error", {
							type: "systemError",
							message: "PhantomJS has crashed."
						} );
					}
				} );
			}
			} )();
		}
	},

	_initBucketState: function(bucket) {
		var self = this;

		for ( var i = 0; i < bucket.size; i++ ) {
			self._getFreshPage( bucket, function(page) {
				self.pagePool.push( page );
				if ( self.reservationQueue.length > 0 ) {
					self.reserveBox(
						self.reservationQueue.splice( 0, 1 )[0]
					);
				} else if ( self.getPageQueue.length > 0 ) {
					self.getPage(
						self.getPageQueue.splice( 0, 1 )[0]
					);
				}
			} );
		}
	},

	_getFreshPage: function(bucket, callback) {
		var self = this;
		bucket.phantom.createPage( function(err, page) {
			page._boxtree_pageId = self.id++;
			page._boxtree_bucketId = bucket.id;
			page.open( "about:blank", function(err, status) {
				if ( err || status !== "success" ) {
					throw new Error( "Couldn't refresh page to default - error on navigation. Status: " + status );
				}
				page.evaluate( eval( "( function() {" + clientScript + "})" ), function(err) {
					if ( err ) {
						throw new Error( "Couldn't refresh page to default - error on client script injection." );
					}
					callback( page );
				} );
			} );
		} );
	},

	_finalizeBucket: function(index, callback) {
		var self = this,
			bucket = self.buckets[index];

		self._unbindFromPhantomEvents( bucket );
		self.buckets[index] = null;
		bucket.phantom.exit(callback);
	},

	_getBuckets: function( poolSize, bucketsCount ) {
		var createArray = function(size, value) {
			return Array.apply( null, new Array( size ) )
				.map( Number.prototype.valueOf, value );
		};
		var result;
		if ( poolSize <= bucketsCount ) {
			result = createArray( poolSize, 1 );
			return poolSize === bucketsCount ? result : result.concat( createArray( bucketsCount - poolSize, 0 ) );
		} else {
			var remainder = poolSize % bucketsCount;
			if ( remainder === 0 ) {
				return createArray( bucketsCount, poolSize / bucketsCount );
			} else {
				var mainValue = Math.floor( poolSize / bucketsCount );
				mainValue = mainValue === 0 ? 1 : mainValue;
				remainder = poolSize - mainValue * bucketsCount;
				result = createArray( bucketsCount, mainValue );
				for ( var i = 0; i < remainder; i++ ) {
					result[i]++;
				}
				return result;
			}
		}
	}

};

exports.Boxtree = Boxtree;
exports.mock = function(nodePhantomMock) {
	if ( nodePhantomMock ) {
		nodePhantom = nodePhantomMock;
	}
};
exports.cleanMock = function() {
	nodePhantom = require("node-phantom");
};