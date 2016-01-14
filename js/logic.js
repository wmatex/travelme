var map;
function initMap() {
  $(function() {
    map = new google.maps.Map(document.getElementById('map'), {
      center: {lat: 50.075328, lng: 14.420450},
      zoom: 8,
      draggableCursor: 'pointer',
    });
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function (position) {
        map.setCenter({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        map.setZoom(15);
      });
    }
    var origin, destination;
    var _points = {
      origin: null,
      destination: null,
    }
    var markers = {
      origin: null,
      dest: null
    };

    var _directions = null;

    var _places = [];

    var directionsDisplay = new google.maps.DirectionsRenderer();
    directionsDisplay.setMap(map);

    function displayDirectionsPolyline(directions) {
      var points = google.maps.geometry.encoding.decodePath(directions.routes[0].overview_polyline.points);
      _directions = new google.maps.Polyline({
        path: points,
        strokeColor: '#00B3FD',
        strokeWeight: 4,
        map: map,
      });
    }

    function clearPlaces() {
      if (_directions != null) {
        _directions.setMap(null);
        _directions = null;
      }
      $.each(_places, function (key, place) {
        place.m.setMap(null);
      });
      _places = [];
    }

    function searchVenues() {
      if (_points.origin == null || _points.destination == null) return;

      $("#loading").show();
      var section = $('.options input[name=options]:checked').val();
      var radius = $('#radius').val();
      var query = {
        radius: radius,
      };
      if (section != 'all') {
        query.section = section;
      }
      clearPlaces();
      $.getJSON("/route/"+_points.origin.lat() + "," + _points.origin.lng() + "/" + _points.destination.lat() + "," + _points.destination.lng(), query,
      function(data) {
        console.log(data);
        displayDirectionsPolyline(data.directions);

        $.each(data.places, function(key, place) {
          if (typeof place.venue != "undefined") {
            var photo = null;
            if (place.venue.photos.groups.length > 0 && place.venue.photos.groups[0].items.length > 0) {
              var p = place.venue.photos.groups[0].items[0];
              photo = p.prefix + "cap256" + p.suffix;
            }
            var category = place.venue.categories[0].icon;
            var place = {
              m: new google.maps.Marker({
                position: {lat: place.venue.location.lat, lng: place.venue.location.lng },
                map: map,
                icon: category.prefix + "bg_32" + category.suffix,
              }),
              w: new google.maps.InfoWindow({
                content: '<a target="_blank" href="http://foursquare.com/v/' + place.venue.id + '" class="demo-card-image mdl-card mdl-shadow--2dp" style="background: url(\'' + photo + '\') center / cover"><div class="mdl-card__title mdl-card--expand"></div> <div class="mdl-card__actions"> <span class="demo-card-image__filename">' + place.venue.name + '</span> <span class="rating" style="background-color: #' + place.venue.ratingColor + ';">' + place.venue.rating + '</span></div></a>' +
                '<p class="tips">' + place.tips[0].text + '</p>'

              })
            };
            place.m.addListener('click', function() {
              place.w.open(map, place.m);
            });
            _places.push(place);
          }
        });
      }).always(function () {$("#loading").hide(); });
    }

    function createMarker(latLng, point, label) {
      var marker = new google.maps.Marker({
        position: latLng,
        animation: google.maps.Animation.DROP,
        map: map,
        label: label,
        draggable: true,
      });
      marker.addListener('dragend', function(e) {
        _points[point] = e.latLng;
        searchVenues();
      });
      return marker;
    }

    map.addListener('click', function(e) {
      if (_points.origin == null || (_points.origin != null && _points.destination != null)) {
        if (_points.origin != null) {
          _points.origin = null;
          _points.destination = null;
          markers.origin.setMap(null);
          markers.dest.setMap(null);
          markers.origin = null;
          markers.dest = null;
        }
        clearPlaces();
        markers.origin = createMarker(e.latLng, "origin", "S");
        _points.origin = e.latLng;
      } else if (destination == null) {
        markers.dest = createMarker(e.latLng, "destination", "G");
        _points.destination = e.latLng;

        searchVenues();
      }
    });

    $('.options input').change(function() {
      searchVenues();
    });
    google.maps.event.addListenerOnce(map, 'idle', function() {
      google.maps.event.trigger(map, 'resize');
    });
  });

}
