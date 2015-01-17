# Boxtree

Boxtree is a small lib for JavaScript execution in an isolated, browser environment (box). You can spawn new boxes from your script, creating - tree of boxes.

## Dependencies

Boxtree depends on PhantomJS **1.9.7**. You need to have it installed on the PATH, or provide a path to the binary (check the Configuration section).

## Install

After you make sure you have PhantomJS (installed on the PATH or as a standalone binary), run this in the root of your project:

```bash
  $ npm install boxtree --save
```

## Usage

Boxtree exposes a Boxtree class, from which you declare an instance (usually there is no need to declare more than 1, still I wanted to make it more flexible allowing multiple boxtrees).

```javascript
  var pathUtils = require("path"),
      Boxtree = require("boxtree").Boxtree,
      poolSize = 20,            // number of boxes in the pool
      forAllowedTime = 10000;   // time before a box should time-out

  var boxtree = new Boxtree(
      pathUtils.resolve( "..", "bin", "phantomjsBinary" ),
      20
  );

  boxtree.init( function() {
      boxtree.reserveBox( function(box) {
          box
              .addScript( ( "( " + ( function() {
                  // ...
              } ) + " )();" )
              .addScript( ( "( " + ( function() {
                  boxApi.emitEvent( "finish", "Box has finished work." );
              } ) + " )();" )
              .setUrl("...") // if you need to execute the script on a specific page ( works with file:// and url )
              .on( "error", function(error) {
                  // handle error
              } )
              .on( "finish", function(result) {
                  // handle success
                  // release box after you are finished with it
                  boxtree.releaseBox( box )
                  // scrap boxtree
                  boxtree.finalize( function() {
                      //
                  } );
              } )
              .run( forAllowedTime );
      } );
  } );
```

## Configuration

```javascript
  var boxtree = new Boxtree(
      phantomPath,
      poolSize,
      bucketsCount
  );
```

The constructor of Boxtree accepts 3 parameters:
- **phantomPath** - path to phantomjs binary (put `null` in case it's on the PATH)
- **poolSize** - number of pages in the pool (creating pages is time-consuming, that's why there is a pool)
- **bucketsCount** - number of phantomjs instances to fill the specified poolSize

### Why multiple PhantomJS instances (buckets)

Because, sometimes a single script, in a single page, might cause an entire instance of PhantomJS to crash, dragging all the other running boxes with it if they all spawn from the same phantomjs process. That's why we allow any poolSize on any number of buckets (phantomjs instances).

Every bucket provides n pages for the pool, where `n = poolSize / bucketsCount`. For example:

```
poolSize = 20
bucketsCount = 5
pagesPerBucket = 20 / 5 = 4
```

On PhantomJS complete crash, all boxes that were created using its pages, are **recreated** with pages from another bucket (or multiple others).

## boxtree API

### boxtree.init( callback )

Currently there is no lazy initialization - the pool has to be filled, before the boxtree can be used.

### boxtree.reserveBox( function(box) {} )

There is a possibility that at the time you request a box, there isn't a page ready to create a box with it.

This is why the box is returned to you in a callback.

### boxtree.releaseBox( box );

When you are finished with a certain box, you have to make sure to release it, to allow the pool to regain the missing page.

Otherwise you will leak boxes and eventually run the pool dry, with a growing number of queued-up reserveBox calls and 0% chance that they will be served.

### boxtree.finalize( callback )

Kills-off all the PhantomJS instances, detaches boxes from boxtree and generally releases the boxtree instance.

If you are doing this on process end, you should wait for it to complete (**use the callback**). Otherwise there is a chance you will leak memory (hence the stale PhantomJS processes that aren't killed).

### box.setUrl( urlString )

If you need to run scripts on a specific page, you can set a url to navigate. It doesn't matter if you set it before or after an .addScript call, as long as it's before .run() is called on the box.

If you don't set any url, the box will execute scripts on the "about:blank" page.

.setUrl accepts both urls from the web, as well as local files (with the file:// protocol).

### box.addScript( scriptString )

Scripts are executed in the order of their addition to the box.

You should pass a string containing a self executing function (clojure) in this format:

```javascript
  box
      .addScript( ( "( " + ( function() {
          // ...
      } ) + " )();" )
```

We use this format so there is no confusion what can be passed and what can't - this function gets converted to a string so it can't have access to any variables outside of it.

If you want to embed data in it, you can do so like this:

```javascript
  var arg1 = "string",
      arg2 = { thisObject: { is: "serializable" } }

  box
      .addScript( ( "( " + ( function(arg1, arg2) {
          // ...
      } ) + " )( " + JSON.stringify(arg1) + ", " + JSON.stringify(arg2) + ");" )
```

Functions can only be passed as strings:

```javascript
  var myFunc = function() {} + "";
```

### box.on( eventName, callback )

All events triggered with boxApi.emitEvent() or by an error which the box triggered (timeout or runtime script error etc.) can be caught with a handler with box.on() method.

### box.run( timeout )

This method runs the box that you've preset with all of the previous box methods.

If no timeout is passed, default is used - 5000 (5 sec).

If a box times out, it will emit error event `{ type: "timeout", message: "..." }`, which you can catch with an .on() handler.

### box.taskRunTime

Integer property with default 5000.

It specifies the runtime of boxes which were created by a script running in a box (*spawned tasks*).

You can change it to your preference.

### box.cleanScripts()

If you get a timeout or systemError and you think your script should be changed, it's recommended to clean the scripts currently queued on this box and add new ones instead of releasing the box and requesting a new one.

## boxApi

This is the API that your scripts can use within the box. It's a global object, directly accessible from anywhere.

### boxApi.emitEvent( eventName, argument );

This is the way to communicate with the environment outside the box. Your argument should be serializable.

To catch the event in the "outside world" you need to add a handler with the box.on() method (see above for reference).

```javascript
  box
      .addScript( ( "( " + ( function() {
          boxApi.emitEvent( "finish", "Box has finished work." );
      } ) + " )();" )
      .on( "finish", function(result) {
          // handle success
          // release box after you are finished with it
          result.indexOf( "finished work" ).should.not.equal( -1 );
      } )
      .run();
```

### boxApi.spawnTask(script, function( error, result ) {...}[, urlString])

This is how you create branches of the current node of your tree of boxes. If you need to parallelize a task, you can spawn multiple tasks.

The script parameter should follow the same rules as with box.addScript()'s parameter.

In the callback you get either an error or a result from the execution of the task.

The error can be passed by your own code:

```javascript
  boxApi.emitEvent( "error", { type: "customType", message: "..." } )
```

Or it can be a systemError (phantomjs crash) or runtimeError or timeout.

There is a way to spawn a task on a specific url. urlString is an optional parameter. If you pass it, the spawned task's box will first navigate to the specified url and then it will execute the script.

## Spawned Task's boxApi

Spawned tasks (boxes created by boxes) have almost the same api as regular boxes, but even simpler.

You don't get to use events on spawned tasks, other than the error event, which you can emit from there.

The only way to communicate back a result is through the boxApi.finishTask( result ) method.

### boxApi.finishTask( result )

The `result` parameter should be a serializable object.

If the parent task (or regular box) was terminated, the spawned task's finishTask will not cause any trouble (it will silently finish execution in both cases - finishTask or error).

## Supported OS's

Boxtree has been developed and tested only on **OS X**. It might work OK on Windows and Linux, it might be horribly breaking, or the worst - it might only look like it's working OK. Use on your own risk (even in OS X's case :P).

Support for other OS's is definitely coming.

## Contributions

Before you start working on something, read [CONTRIBUTING](./CONTRIBUTING.md).

To run the tests for _should_ simply run:

    $ grunt

Versions of dependencies are locked through:

```bash
  $ npm shrinkwrap --dev
```

Rerun this command if you add/change/remove a dependency to regenerate npm-shrinkwrap.

I had to lock the versions because boxtree's only dependency, node-phantom, doesn't work with the current version of socket.io (dependency of node-phantom), but the author still uses the ~ in-front of the version of socket.io in the package.json of node-phantom.

## TODO

 - Finalize instances on finalize of boxtree. (otherwise running instances will throw an error - timeout).

## Release History

 - 1.0.4
   - Fix: instance tests fail on Windows.
 - 1.0.3
   - Fix: crash on bucketCrash after boxtree.finalize is called.
 - 1.0.2
   - Fix: releasing a box after boxtree.finalize() has been called results in js error.
 - 1.0.1
   - Fix: can't load a page with ssl errors.
 - 1.0.0
   - Init.

## License

MIT &copy; 2014 Nikolay Tsenkov