var _ = require('lodash');
var dirHas = require('./dirHas');
var find = _.find;
var fs = require('fs');
var path = require('path');
var stringOrArray = require('./stringOrArray');
var transformDeps = require('transform-jest-deps');
var unwin = require('unwin');
var webpackInfo = require('./webpackInfo');

var defaultAliases = {};
var defaultFallbackDirs = [];
var defaultFileExtensions = ['', '.webpack.js', '.web.js', '.js'];
var defaultModulesDirs = ['node_modules', 'web_modules'];

var aliases;
var fileExtensions;
var moduleDirs;
var webpackSettings;
var nodeModulesDirs;

function ensureWebpackInfo(filename) {
  if (webpackSettings) {
    return;
  }

  webpackSettings = webpackInfo.read({filename: filename});
  var resolveConfig = webpackSettings.config.resolve;
  var webpackDir = path.dirname(webpackSettings.file);
  aliases = resolveConfig.alias || defaultAliases;
  fileExtensions = resolveConfig.extensions || defaultFileExtensions;

  var rootDirs = stringOrArray(resolveConfig.root);
  var modDirs = stringOrArray(resolveConfig.modulesDirectories) || defaultModulesDirs;
  var fallbackDirs = stringOrArray(resolveConfig.fallback) || defaultFallbackDirs;

  moduleDirs = _.union(rootDirs, modDirs, fallbackDirs)
  .map(function(dir) {
    return path.resolve(webpackDir, dir);
  })
  .filter(function(dir) {
    return fs.existsSync(dir);
  });

  nodeModulesDirs = moduleDirs.filter(function(dir) {
    return path.basename(dir) === 'node_modules';
  });
}

function firstDir(filename) {
  return filename.split('/')[0];
}

function matchAlias(dependency) {
  var alias = aliases[dependency];
  if (alias) {
    var dirname = firstDir(alias);
    return {
      dirname: dirname,
      rest: alias.slice(dirname.length + 1)
    };
  } else {
    return undefined;
  }
}

function resolveExtension(matchingFirstDir, afterFirstDir) {
  var absMatch = afterFirstDir ? path.join(matchingFirstDir, afterFirstDir) : matchingFirstDir;
  var dirname = path.dirname(absMatch);
  var ext = find(fileExtensions, function(ext) {
    return dirHas(dirname, path.basename(absMatch + ext));
  });
  return ext;
}

function resolveFirstDir(dirname, rest) {
  var matchingDir, matchingExt;

  if (rest) {
    matchingDir = find(moduleDirs, function(aliasDir) {
      return dirHas(aliasDir, dirname);
    });
  } else {
    matchingDir = find(moduleDirs, function(aliasDir) {
      matchingExt = resolveExtension(aliasDir, dirname);
      return matchingExt !== undefined;
    });
  }

  return {
    dir: matchingDir,
    ext: matchingDir ? (matchingExt || '') : ''
  };
}

function resolveRelativeDependency(dependency, filename) {
  var absMatch = path.resolve(path.dirname(filename), dependency);
  var ext = resolveExtension(absMatch) || '';
  return dependency + ext;
}

function resolveDependencyToMatch(matchingFirstDir, afterFirstDir, filename) {
  var absMatch = afterFirstDir ? path.join(matchingFirstDir, afterFirstDir) : matchingFirstDir;
  var srcDir = path.dirname(filename);
  var relPath = unwin(path.relative(srcDir, absMatch));
  if (relPath.slice(0, 1) != '.') {
    relPath = './' + relPath;
  }
  return relPath;
}

function resolve(dependency, filename) {
  if (dependency.slice(0, 1) === '.') {
    return resolveRelativeDependency(dependency, filename);
  }

  var dirname = firstDir(dependency);
  var rest = dependency.slice(dirname.length + 1);

  var alias = matchAlias(dirname);
  if (alias) {
    dirname = alias.dirname;
    rest = alias.rest || rest;
    dependency = dirname + (rest ? '/' + rest : '');
  }

  var matchingFirstDir = resolveFirstDir(dirname, rest);
  if (!matchingFirstDir.dir || _.contains(nodeModulesDirs, matchingFirstDir.dir)) {
    return dependency;
  }

  var matchingDir = path.join(matchingFirstDir.dir, dirname) + matchingFirstDir.ext;
  var relative = resolveDependencyToMatch(matchingDir, rest, filename);
  var ext = rest ? (resolveExtension(matchingDir, rest) || '') : '';

  return relative + ext;
}

function process(src, filename) {
  ensureWebpackInfo(filename);
  var transformed = transformDeps(src, function(dependency) {
    return resolve(dependency, filename);
  });
  return transformed;
}

exports.process = process;
