var gulp  = require('gulp');
var gutil = require('gulp-util');

gulp.task('clean', function () {
    require('fs-extra').removeSync(__dirname + '/build');
});

gulp.task('build:lib', function () {
    var traceur = require('gulp-traceur');

    return gulp.src('lib/*.js')
        .pipe(traceur())
        .pipe(gulp.dest('build/lib'));
});

gulp.task('build:docs', function () {
    var ignore = require('fs').readFileSync('.npmignore').toString()
        .trim().split(/\n+/)
        .concat(['.npmignore', 'package.json', 'index.js'])
        .map(function (i) { return '!' + i; });

    return gulp.src(['*'].concat(ignore))
        .pipe(gulp.dest('build'));
});

gulp.task('build:package', function () {
    var editor = require('gulp-json-editor');

    return gulp.src('package.json')
        .pipe(editor(function (json) {
            json.main = 'lib/postcss';
            json.devDependencies.traceur = json.dependencies.traceur;
            delete json.dependencies.traceur;
            return json;
        }))
        .pipe(gulp.dest('build'));
});

gulp.task('build', ['clean', 'build:lib', 'build:docs', 'build:package']);

gulp.task('lint:test', function () {
    var jshint = require('gulp-jshint');

    return gulp.src('test/*.js')
        .pipe(jshint({ esnext: true, expr: true }))
        .pipe(jshint.reporter('jshint-stylish'))
        .pipe(jshint.reporter('fail'));
});

gulp.task('lint:lib', function () {
    var jshint = require('gulp-jshint');

    return gulp.src(['lib/*.js', 'index.js', 'gulpfile.js'])
        .pipe(jshint({ esnext: true }))
        .pipe(jshint.reporter('jshint-stylish'))
        .pipe(jshint.reporter('fail'));
});

gulp.task('lint', ['lint:test', 'lint:lib']);

var zlib, request;
var get = function (url, callback) {
    if ( !zlib ) {
        zlib    = require('zlib');
        request = require('request');
    }

    request.get({ url: url, headers: { 'accept-encoding': 'gzip,deflate' } })
        .on('response', function (res) {
            var chunks = [];
            res.on('data', function (i) {
                chunks.push(i);
            });
            res.on('end', function () {
                var buffer = Buffer.concat(chunks);

                if ( res.headers['content-encoding'] == 'gzip' ) {
                    zlib.gunzip(buffer, function (err, decoded) {
                        callback(decoded.toString());
                    });

                } else if ( res.headers['content-encoding'] == 'deflate' ) {
                    zlib.inflate(buffer, function (err, decoded) {
                        callback(decoded.toString());
                    });

                } else {
                    callback(buffer.toString());
                }
            });
        });
};

var styles = function (url, callback) {
    get(url, function (html) {
        var styles = html.match(/[^"]+\.css("|')/g);
        if ( !styles ) throw "Can't find CSS links at " + url;
        styles = styles.map(function(path) {
            path = path.slice(0, -1);
            if ( path.match(/^https?:/) ) {
                return path;
            } else {
                return path.replace(/^\.?\.?\/?/, url);
            }
        });
        callback(styles);
    });
};

gulp.task('bench', ['build'], function (done) {
    var indent = function (max, current) {
        var diff = max.toString().length - current.toString().length;
        for ( var i = 0; i < diff; i++ ) {
            process.stdout.write(' ');
        }
    };

    var times = { };
    var bench = function (title, callback) {
        process.stdout.write(title + ': ');
        indent('Gonzales PE', title);

        var start = new Date();

        for ( var i = 0; i < 10; i++ ) callback();

        time = (new Date()) - start;
        time = Math.round(time / 10);
        process.stdout.write(time + " ms");

        if ( times.PostCSS ) {
            var slower = time / times.PostCSS;
            if ( time < 100 ) process.stdout.write(' ');

            var result;
            if ( slower < 1 ) {
                result = ' (' + (1 / slower).toFixed(1) + ' times faster)';
            } else {
                result = ' (' + slower.toFixed(1) + ' times slower)';
            }
            process.stdout.write(result);
        }
        times[title] = time;
        process.stdout.write("\n");
    };

    styles('https://github.com/', function (styles) {
        gutil.log('Load Github style');
        get(styles[0], function (css) {
            process.stdout.write("\n");

            var postcss = require(__dirname + '/build');
            bench('PostCSS', function () {
                return postcss().process(css).css;
            });

            var CSSOM = require('cssom');
            bench('CSSOM', function () {
                return CSSOM.parse(css).toString();
            });

            var rework = require('rework');
            bench('Rework', function () {
                return rework(css).toString();
            });

            var gonzales = require('gonzales');
            bench('Gonzales', function () {
                return gonzales.csspToSrc( gonzales.srcToCSSP(css) );
            });

            var gonzalesPe = require('gonzales-pe');
            bench('Gonzales PE', function () {
                return gonzalesPe.astToSrc({
                    ast: gonzalesPe.srcToAST({ src: css })
                });
            });

            process.stdout.write("\n");
            done();
        });
    });
});

gulp.task('integration', function (done) {
    var postcss = require('./');
    var test = function (css) {
        var processed;
        try {
            processed = postcss().process(css, {
                map: { annotation: false }
            }).css;
        } catch (e) {
            return 'Parsing error: ' + e.message + "\n\n" + e.stack;
        }

        if ( processed != css ) {
            return 'Output is not equal input';
        }
    };

    var links = [];
    var nextLink = function () {
        if ( links.length === 0 ) {
            nextSite();
            return;
        }

        var url = links.shift();
        get(url, function (css) {
            var error = test(css);
            if ( error ) {
                done(new gutil.PluginError('integration', {
                    showStack: false,
                    message:   "\nFile " + url + "\n\n" + error
                }));
            } else {
                nextLink();
            }
        });
    };

    var sites = [{ name: 'GitHub',       url: 'https://github.com/' },
                 { name: 'Twitter',      url: 'https://twitter.com/' },
                 { name: 'Bootstrap',    url: 'http://getbootstrap.com/' },
                 { name: 'Habrahabr',    url: 'http://habrahabr.ru/' },
                 { name: 'Browserhacks', url: 'http://browserhacks.com/' }];
    var nextSite = function () {
        if ( sites.length === 0 ) {
            done();
            return;
        }
        var site = sites.shift();

        gutil.log('Test ' + site.name + ' styles');
        styles(site.url, function (styles) {
            links = styles;
            nextLink();
        });
    };

    nextSite();
});

gulp.task('test', function () {
    require('./');
    var mocha = require('gulp-mocha');

    return gulp.src('test/*.js', { read: false })
        .pipe(mocha())
        .on('error', process.exit.bind(process, 1));
});

gulp.task('default', ['lint', 'test', 'integration']);
