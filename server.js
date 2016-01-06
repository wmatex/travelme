#!/bin/env node
//  OpenShift sample Node application
var express = require('express');
var fs      = require('fs');
var request = require('request');
var extend = require('util')._extend;
var async  = require('async');
var polyline = require('polyline');

// require('request').debug = true;

/**
 *  Define the sample application.
 */
var SampleApp = function() {

    //  Scope.
    var self = this;

    /*  ================================================================  */
    /*  Helper functions.                                                 */
    /*  ================================================================  */

    /**
     *  Set up server IP address and port # using env variables/defaults.
     */
    self.setupVariables = function() {
        //  Set the environment variables we need.
        self.ipaddress = process.env.OPENSHIFT_NODEJS_IP;
        self.port      = process.env.OPENSHIFT_NODEJS_PORT || 8080;

        self.directionsAPI = 'https://maps.googleapis.com/maps/api/directions/json?';
        self.foursquareAPI = 'https://api.foursquare.com/v2/venues/explore';

        self.MAX_FSQ_REQUESTS = 100;
        self.DEG2RAD = (3.14159265358979/180.0);
        self.RADIUS = 100;
        self.TIMEOUT = 2000;

        if (typeof self.ipaddress === "undefined") {
            //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
            //  allows us to run/test the app locally.
            console.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
            self.ipaddress = "127.0.0.1";
        };
    };




    /**
     *  terminator === the termination handler
     *  Terminate server on receipt of the specified signal.
     *  @param {string} sig  Signal to terminate on.
     */
    self.terminator = function(sig){
        if (typeof sig === "string") {
           console.log('%s: Received %s - terminating sample app ...',
                       Date(Date.now()), sig);
           process.exit(1);
        }
        console.log('%s: Node server stopped.', Date(Date.now()) );
    };


    /**
     *  Setup termination handlers (for exit and a list of signals).
     */
    self.setupTerminationHandlers = function(){
        //  Process on exit and signals.
        process.on('exit', function() { self.terminator(); });

        // Removed 'SIGPIPE' from the list - bugz 852598.
        ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
         'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
        ].forEach(function(element, index, array) {
            process.on(element, function() { self.terminator(element); });
        });
    };


    /*  ================================================================  */
    /*  App server functions (main app logic here).                       */
    /*  ================================================================  */

    function jsonRequest(url, query, success, fail) {
      return request({
        url: url, //URL to hit
        qs: query, //Query string data
        method: 'GET', //Specify the method
        headers: { //We can define headers too
          'Content-Type': 'application/json',
        },
        timeout: self.TIMEOUT,
      }, function(error, response, body){
        if(error) {
          fail(error);
        } else {
          success(response, JSON.parse(body));
        }
      });
    }

    function foursquareRequest(options, success, fail) {
      var fopts = extend(options, {
          client_id: 'GOOXRPVHTF4EWWQ3XYW0R1BENO2SNXSKTSEHCMRQHUVEFYPT',
          client_secret: 'LCCI2TUVFRBNMY4AAUBFVTT3D4BIGJFXIRPTX425QABJMNCP',
          v: '20160105',
          m: 'foursquare',
          llAcc: 1,
          openNow: 1,
          venuePhotos: 1,
          limit: 50,
        });
      return jsonRequest(
        self.foursquareAPI,
        fopts,
        success,
        fail
      );
    }

    function llDistance(lat1, lng1, lat2, lng2) {
      lat1 *= self.DEG2RAD;
      lat2 *= self.DEG2RAD;
      lng1 *= self.DEG2RAD;
      lng2 *= self.DEG2RAD;
      var R = 6371000;
      var x = (lng2-lng1) * Math.cos((lat1+lat2)/2);
      var y = (lat2-lat1);
      return Math.sqrt(x*x + y*y) * R;
    }

    function processVenues(callback, points) {
      return function(response, data) {
        if (data.response.totalResults > 0) {
          var items = data.response.groups[0].items;
          // callback(null, closest);
          callback(null, items);
        } else {
          console.warn(data);
          callback(null, null);
        }
      }
    }

    function findCenter(points) {
      var s = points[0], e = points[points.length-1];
      var cL = (s[0]+e[0])/2, cG = (s[1]+e[1])/2;
      var center = null;
      var minD = Number.MAX_SAFE_INTEGER;
      points.forEach(function(p) {
        var d =llDistance(cL, cG, p[0], p[1]);
        if (d < minD) {
          center = p;
          minD = d;
        }
      });
      return center;
    }


    /**
     *  Create the routing table entries + handlers for the application.
     */
    self.createRoutes = function() {
      self.app.get('/route/:start/:end', function(req, res) {
        res.setHeader('Content-Type', 'application/json');

        var startPoint = req.params.start;
        var endPoint   = req.params.end;

        var section = null;
        if (typeof req.query != "undefined" && typeof req.query.section != "undefined") {
          section = req.query.section ;
        }
        var radius = self.RADIUS;
        if (typeof req.query != "undefined" && typeof req.query.radius != "undefined") {
          radius = req.query.radius;
        }

        jsonRequest(
          self.directionsAPI,
          {
            origin: startPoint,
            destination: endPoint,
            mode: "walking",
          },
          function (response, data) {
            var points = polyline.decode(data.routes[0].overview_polyline.points);
            var startPoint = points[0], endPoint = points[points.length-1];
            var distance = llDistance(startPoint[0], startPoint[1], endPoint[0], endPoint[1]);
            var center = findCenter(points);
            var requests = [];
            var candidates = [points[0], center, points[1]];
            candidates.forEach(function(c) {
              requests.push(
                function (callback) {
                  foursquareRequest({
                    ll: c[0]+","+c[1],
                    radius: distance/2,
                    section: section,
                  },
                  processVenues(callback, points),
                  function (error) {
                    console.log("Foursquare request error: " + error);
                    callback(null, null);
                  }
                );
              });
            });
            async.parallel(
              requests,
              function (err, results) {
                var closest = [];
                var keys = {};
                points.forEach(function (point) {
                  var prefix = 1000;
                  results.forEach(function (result) {
                    if (result) {
                      result.forEach(function (item, index) {
                        if (!keys.hasOwnProperty(prefix+index)) {
                          var d = llDistance(point[0], point[1], item.venue.location.lat, item.venue.location.lng);
                          if (d < radius) {
                            closest.push(item);
                            keys[prefix+index] = true;
                          }
                        }
                      });
                    }
                    prefix *= 2;
                  });
                });
                res.send({
                  places: closest,
                  directions: data
                });
              }
            );
          },
          function (error) {
            console.log(error);
          }
        );
      });

      self.app.get("/", function (req, res) {
        res.setHeader('Content-Type', 'text/html');
        res.send(fs.readFileSync('./index.html'));
      });
    };


    /**
     *  Initialize the server (express) and create the routes and register
     *  the handlers.
     */
    self.initializeServer = function() {
        self.app = express.createServer();
        self.createRoutes();
    };


    /**
     *  Initializes the sample application.
     */
    self.initialize = function() {
        self.setupVariables();
        self.setupTerminationHandlers();

        // Create the express server and routes.
        self.initializeServer();
    };


    /**
     *  Start the server (starts up the sample application).
     */
    self.start = function() {
        //  Start the app on the specific interface (and port).
        self.app.listen(self.port, self.ipaddress, function() {
            console.log('%s: Node server started on %s:%d ...',
                        Date(Date.now() ), self.ipaddress, self.port);
        });
    };

};   /*  Sample Application.  */



/**
 *  main():  Main code.
 */
var zapp = new SampleApp();
zapp.initialize();
zapp.start();
