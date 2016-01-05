#!/bin/env node
//  OpenShift sample Node application
var express = require('express');
var fs      = require('fs');
var request = require('request');
var extend = require('util')._extend;
var async  = require('async');

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

        self.MAX_FSQ_REQUESTS = 5;

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
        timeout: 1000,
      }, function(error, response, body){
        if(error) {
          fail(error);
        } else {
          success(response, JSON.parse(body));
        }
      });
    }

    function foursquareRequest(options, success, fail) {
      console.log(options);
      var fopts = extend(options, {
          client_id: 'GOOXRPVHTF4EWWQ3XYW0R1BENO2SNXSKTSEHCMRQHUVEFYPT',
          client_secret: 'LCCI2TUVFRBNMY4AAUBFVTT3D4BIGJFXIRPTX425QABJMNCP',
          v: '20160105',
          m: 'foursquare',
          llAcc: 1,
          openNow: 1,
          venuePhotos: 1
        });
      return jsonRequest(
        self.foursquareAPI,
        fopts,
        success,
        fail
      );
    }

    function processVenues(callback) {
      return function(response, data) {
        console.log(data);
        if (data.response.totalResults > 0) {
          callback(null, data.response.groups[0].items);
        } else {
          callback(null, null);
        }
      }
    }

    /**
     *  Create the routing table entries + handlers for the application.
     */
    self.createRoutes = function() {
      self.app.get('/route/:start/:end', function(req, res) {

        res.setHeader('Content-Type', 'application/json');

        var startPoint = req.params.start;
        var endPoint   = req.params.end;

        jsonRequest(
          self.directionsAPI,
          {
            origin: startPoint,
            destination: endPoint,
            mode: "walking",
          },
          function (response, data) {
            var steps = data.routes[0].legs[0].steps;
            var venues = [];
            var resp = [{
              lat: data.routes[0].legs[0].start_location.lat,
              lng: data.routes[0].legs[0].start_location.lng
            }];
            var requests = [
              function (callback) {
                var ll = data.routes[0].legs[0].start_location.lat + "," +
                  data.routes[0].legs[0].start_location.lng;
                foursquareRequest({
                  ll: ll,
                  radius: 100,
                },
                processVenues(callback),
                function(error) {
                  console.log(error);
                  callback(null, error);
                });
              }
            ];
            var nOfSteps = steps.length;
            var skip = Math.ceil((nOfSteps+1)/self.MAX_FSQ_REQUESTS);
            if (skip < 1) skip = 1;
            steps.forEach(function(step, index) {
              if ((index+1) % skip == 0) {
                requests.push(
                  function (callback) {
                    var ll =step.end_location.lat + "," +
                    step.end_location.lng;
                    foursquareRequest({
                      ll: ll,
                      radius: 100,
                    },
                    processVenues(callback),
                    function (error) {
                      console.log("Foursquare request error: " + error);
                      callback(null, error);
                    }
                  );
                }
              );
            }
            });
            console.log(requests.length);
            async.parallel(
              requests,
              function (err, results) {
                res.send({
                  places: results,
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
