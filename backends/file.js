var send = require('send');
var walk = require('walk');
var probe = require('node-ffprobe');
var path = require('path');
var mongo = 'mongodb://localhost:27017/fileservice';
var db = require('mongoskin').db(mongo, {native_parser:true, safe:true});
var url = require('url');

var fileBackend = {};

var config;
var walker;

var medialibraryPath = "./media";


var fs = require('fs');

// cache songID to disk.
// on success: callback must be called with file path as argument
// on failure: errCallback must be called with error message
fileBackend.cache = function(songID, callback, errCallback) {
    console.log("fileBackend.cache " + songID);
    db.collection('songs').findById(songID, function (err, item) {
        console.log('"Cache" provided: ' + item.file);
        callback(item.file);
    });
};
fileBackend.search = function(terms, callback, errCallback) {
    db.collection('songs').find({ $text: { $search: terms} }).toArray(
        function (err, items) {
            var termsArr = terms.split(" ");
            termsArr.forEach(function(e, i, arr) {arr[i] = e.toLowerCase()});
            for (var i in items) {
                items[i].score = 0;
                var words = [];
                if (items[i].title.split)
                    words = words.concat(items[i].title.split(" "));
                if (items[i].artist.split)
                    words = words.concat(items[i].artist.split(" "));
                if (items[i].album.split)
                    words = words.concat(items[i].album.split(" "));
                words.forEach(function(e, i, arr) {arr[i] = e.toLowerCase()});
                for (var ii in words) {
                    if (termsArr.indexOf(words[ii]) >= 0) {
                        items[i].score++;
                    }
                }
            }
            items.sort(function(a, b) {
                return b.score - a.score; // sort by score
            })
            var songs = [];
            for (var song in items) {
                songs.push({
                    title: items[song].title,
                    artist: items[song].artist,
                    album: items[song].album,
                    duration: items[song].duration,
                    id: items[song]._id,
                    backend: 'file'
                });
                if (songs.length > 10) break;
            }
            // console.log(songs);
            callback(songs);
    });
};
var upserted = 0;
var toProbe = 0;
var probeCallback = function(err, probeData) {
    toProbe--;
    var formats = ["mp3"];
    if (probeData) {
        if (formats.indexOf(probeData.format.format_name) >= 0) { // Format is supported
            var song = {
                title: "",
                artist: "",
                album: "",
                duration: "0",
            };
            if (probeData.metadata.title != undefined)
                song.title = probeData.metadata.title;
            if (probeData.metadata.artist != undefined)
                song.artist = probeData.metadata.artist;
            if (probeData.metadata.album != undefined)
                song.album = probeData.metadata.album;
            song.duration = probeData.format.duration * 1000;
            db.collection('songs').update({file: probeData.file}, {'$set':song}, {upsert: true},
                function(err, result) {
                    if (result == 1) {
                        console.log("Upserted: " + probeData.file);
                        upserted++;
                    } else
                        console.log(err);
            });
        }
    } else if (err) {
        console.log(err);
    }
}
var durationToString = function(seconds) {
    var durationString = Math.floor(seconds / 60);
    durationString += ":" + pad(Math.floor(seconds % 60), 2);
    return durationString;
}
var pad = function(number, length) {
    var str = '' + number;
    while (str.length < length) {
        str = '0' + str;
    }
    return str;
}
fileBackend.init = function(_config, callback) {
    console.log("fileBackend.init");
    config = _config;

    var cb = function(arg1, arg2) {console.log(arg1);console.log(arg2)}
    db.collection('songs').ensureIndex({ title: "text", artist: "text", album: "text" }, cb);

    var options = {
        followLinks: false
    };

    var startTime = new Date();
    walker = walk.walk(medialibraryPath, options);
    var scanned = 0;
    walker.on("file", function (root, fileStats, next) {
        file = path.join(root, fileStats.name);
        console.log("Scanning: " + file)
        scanned++;
        toProbe++;
        probe(file, probeCallback);
        next();
    });
    walker.on("end", function() {
        var scanResultInterval = setInterval(function() {
            if (toProbe == 0) {
                console.log("Scanned files: " + scanned);
                console.log("Upserted files: " + upserted);
                console.log("Done in: " + Math.round((new Date() - startTime) / 1000) + " seconds");
                clearInterval(scanResultInterval);
            }
        }, 100);
    });
};
fileBackend.middleware = function(req, res, next) {
    console.log("fileBackend.middleware");
    var id = url.parse(req.url).pathname;
    id = id.substr(1);
    id = id.split('.')[0];

    db.collection('songs').findById(id, function (err, item) {
        console.log(id + ": " + item.file);

        send(req, item.file).pipe(res);
    });

};
module.exports = fileBackend;
