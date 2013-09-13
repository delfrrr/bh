var BH = require('../lib/bh'),
Vow = require('vow');
require('chai').should();

var _init = BH.prototype._init;

BH.prototype._init = function () {
    this.utils.applyBaseAsync = function (changes) {
        var prevCtx = this.ctx,
            prevNode = this.node,
            prevValues;
        if (changes) {
            prevValues = {};
            for (key in changes) {
                if (dirtyEnv && !changes.hasOwnProperty(key)) continue;
                prevValues[key] = prevCtx[key];
                prevCtx[key] = changes[key];
            }
        }
        return this.bh.processBemJsonAsync(this.ctx, this.ctx.block, true).then(function (res) {
            var key;
            if (res !== prevCtx) {
                this.newCtx = res;
            }
            if (changes) {
                for (key in changes) {
                    if (dirtyEnv && !changes.hasOwnProperty(key)) continue;
                    prevCtx[key] = prevValues[key];
                }
            }
            this.ctx = prevCtx;
            this.node = prevNode;
        });
    };
    return _init.apply(this, arguments);
};

BH.prototype._processAsyncSubRes = function (json, blockName, arr, index, subRes) {
    if (subRes) {
        arr[index] = subRes;
        return this.processBemJsonAsync(subRes, blockName);
    } else {
        arr[index] = json;
        this.processBemJsonAsync(json.content, blockName);
    }
};

BH.prototype.processBemJsonAsync = function (bemJson, blockName, ignoreContent) {
    if (!this._inited) {
        this._init();
    }
    var resultArr = [bemJson];
    var promise = Vow.promise();
    var promises = [promise];
    try {
        var nodes = [{ json: bemJson, arr: resultArr, index: 0, blockName: blockName, blockMods: bemJson.mods || {} }];
        var node, json, block, blockMods, i, l, p, child, subRes;
        var compiledMatcher = (this._fastMatcher || (this._fastMatcher = Function('ms', this.buildMatcher())(this._matchers)));
        var processContent = !ignoreContent;
        var infiniteLoopDetection = this._infiniteLoopDetection;

        /**
         * Враппер для json-узла.
         * @constructor
         */
        function Ctx() {
            this.ctx = null;
            this.newCtx = null;
        }
        Ctx.prototype = this.utils;
        var ctx = new Ctx();
        while (node = nodes.shift()) {
            json = node.json;
            block = node.blockName;
            blockMods = node.blockMods;
            if (Array.isArray(json)) {
                for (i = 0, l = json.length; i < l; i++) {
                    child = json[i];
                    if (child !== false && child != null && typeof child === 'object') {
                        nodes.push({ json: child, arr: json, index: i, blockName: block, blockMods: blockMods, parentNode: node });
                    }
                }
            } else {
                var content, stopProcess = false;
                if (json.elem) {
                    block = json.block = json.block || block;
                    blockMods = json.blockMods = json.blockMods || blockMods;
                    if (json.elemMods) {
                        json.mods = json.elemMods;
                    }
                } else if (json.block) {
                    block = json.block;
                    blockMods = json.mods || (json.mods = {});
                }

                if (json.block) {

                    if (infiniteLoopDetection) {
                        json.__processCounter = (json.__processCounter || 0) + 1;
                        if (json.__processCounter > 100) {
                            throw new Error('Infinite loop detected at "' + json.block + (json.elem ? '__' + json.elem : '') + '".');
                        }
                    }

                    subRes = null;

                    if (!json._stop) {
                        ctx.node = node;
                        ctx.ctx = json;
                        subRes = compiledMatcher(ctx, json);
                        if (subRes) {
                            if (Vow.isPromise(subRes)) {
                                promises.push(subRes.then(this._processAsyncSubRes.bind(this, json, block, node.arr, node.index)));
                                ctx = new Ctx();
                            } else {
                                json = subRes;
                                node.json = json;
                                node.blockName = block;
                                node.blockMods = blockMods;
                                nodes.push(node);
                            }
                            stopProcess = true;
                        }
                    }

                }
                if (!stopProcess) {
                    if (Array.isArray(json)) {
                        node.json = json;
                        node.blockName = block;
                        node.blockMods = blockMods;
                        nodes.push(node);
                    } else {
                        if (processContent && (content = json.content)) {
                            if (Array.isArray(content)) {
                                var flatten;
                                do {
                                    flatten = false;
                                    for (i = 0, l = content.length; i < l; i++) {
                                        if (Array.isArray(content[i])) {
                                            flatten = true;
                                            break;
                                        }
                                    }
                                    if (flatten) {
                                        json.content = content = content.concat.apply([], content);
                                    }
                                } while (flatten);
                                for (i = 0, l = content.length, p = l - 1; i < l; i++) {
                                    child = content[i];
                                    if (child !== false && child != null && typeof child === 'object') {
                                        nodes.push({ json: child, arr: content, index: i, blockName: block, blockMods: blockMods, parentNode: node });
                                    }
                                }
                            } else {
                                nodes.push({ json: content, arr: json, index: 'content', blockName: block, blockMods: blockMods, parentNode: node });
                            }
                        }
                    }
                }
            }
            node.arr[node.index] = json;
        }
        promise.fulfill();
    } catch (err) {
        promise.reject(err);
    }

    return Vow.all(promises).then(function () {
        return resultArr[0];
    });
};

describe('bh.processBemJsonAsync()', function() {
    describe('common support', function () {
        beforeEach(function() {
            bh = new BH();
        });
        it('should return promise', function (done) {
            bh.match('test', function (ctx) {
                ctx.content('test');
            });
            bh.processBemJsonAsync({block: 'test'}).then(function (json) {
                json.content.should.equal('test');
                done();
            }).done();
        });
        it('content async', function (done) {
            bh.match('test', function (ctx) {
                var promise = Vow.promise();
                setTimeout(function () {
                    ctx.content('test');
                    promise.fulfill();
                });
                return promise;
            });
            bh.processBemJsonAsync({block: 'test'}).then(function (json) {
                json.content.should.equal('test');
                done();
            }).done();
        });
        it('async params and sync content', function (done) {
            bh.match('test', function (ctx) {
                ctx.content(ctx.param('setContent'));
            });
            bh.match('test', function (ctx) {
                var promise = Vow.promise();
                setTimeout(function () {
                    ctx.param('setContent', 'async content');
                    ctx.applyBase();
                    promise.fulfill();
                });
                return promise;
            });
            bh.processBemJsonAsync({block: 'test'}).then(function (json) {
                json.content.should.equal('async content');
                json.setContent.should.equal('async content');
                done();
            }).done();
        });
        it('nested blocks', function (done) {

            bh.match('test-wraper', function (ctx) {
                ctx.content([{block: 'test'}]);
            });
            bh.match('test', function (ctx) {
                ctx.content([
                    {block: 'content', content: 'sync content'},
                    {block: 'content', mods: {type: 'async'}}
                ]);
            });
            bh.match('content', function (ctx) {
                ctx.content({block: 'content-wraper', setContent: ctx.content()}, true);
            });
            bh.match('content_type_async', function (ctx) {
                var promise = Vow.promise();
                setTimeout(function () {
                    ctx.content('async content');
                    ctx.applyBase();
                    promise.fulfill();
                });
                return promise;
            });
            bh.match('content-wraper', function (ctx) {
                ctx.content(ctx.param('setContent'));
            });
            bh.processBemJsonAsync({block: 'test-wraper'}).then(function (json) {
                json.content[0].block.should.equal('test');
                json.content[0].content[0].content.content.should.equal('sync content');
                json.content[0].content[1].content.content.should.equal('async content');
                done();
            }).done();
        });
        it('async elements', function (done) {
            bh.match('test-wraper', function (ctx) {
                ctx.content({block: 'test'});
            });
            bh.match('test', function (ctx) {
                ctx.content([
                    {elem: 'sync'},
                    {elem: 'async'},
                    {elem: 'sync'},
                    {elem: 'async'}
                ]);
            });
            bh.match('test__sync', function (ctx) {
                ctx.content({block: 'content-wraper', setContent: 'sync content'});
            });
            bh.match('test__async', function (ctx) {
                var promise = Vow.promise();
                setTimeout(function () {
                    ctx.content({block: 'content-wraper', setContent: 'async content'});
                    promise.fulfill();
                });
                return promise;
            });
            bh.match('content-wraper', function (ctx) {
                ctx.content(ctx.param('setContent'));
            });
            bh.processBemJsonAsync({block: 'test-wraper'}).then(function (json) {
                json.content.content[0].content.content.should.equal('sync content');
                json.content.content[1].content.content.should.equal('async content');
                json.content.content[2].content.content.should.equal('sync content');
                json.content.content[3].content.content.should.equal('async content');
                done();
            }).done();
        });
        it('async replace content', function (done) {
            bh.match('test', function (ctx) {
                ctx.content([
                    {elem: 'sync'},
                    {elem: 'async'},
                    {elem: 'sync'},
                    {elem: 'async'}
                ]);
            });
            bh.match('test__sync', function (ctx) {
                return {block: 'content-wraper', setContent: 'sync content'};
            });
            bh.match('test__async', function (ctx) {
                return Vow.fulfill().then(function () {
                    return {block: 'content-wraper', setContent: 'async content'};
                });
            });
            bh.match('content-wraper', function (ctx) {
                ctx.content(ctx.param('setContent'));
            });
            bh.processBemJsonAsync({block: 'test'}).then(function (json) {
                json.content[0].content.should.equal('sync content');
                json.content[1].content.should.equal('async content');
                json.content[2].content.should.equal('sync content');
                json.content[3].content.should.equal('async content');
                done();
            }).done();
        });
        it('async replace content', function (done) {
            bh.match('test', function (ctx) {
                ctx.content([
                    {elem: 'sync'},
                    {elem: 'async'},
                    {elem: 'sync'},
                    {elem: 'async'}
                ]);
            });
            bh.match('test__sync', function (ctx) {
                return {block: 'content-wraper', setContent: 'sync content'};
            });
            bh.match('test__async', function (ctx) {
                var json = ctx.json();
                ctx.content(json.prefix + ' ' + json.sufix);
            });
            bh.match('test__async', function (ctx) {
                return Vow.fulfill().then(function () {
                    ctx.param('prefix', 'async');
                   return ctx.applyBaseAsync();
                });
            });
            bh.match('test__async', function (ctx) {
                return Vow.fulfill().then(function () {
                   ctx.param('sufix', 'content');
                   return ctx.applyBaseAsync();
                });
            });
            bh.match('content-wraper', function (ctx) {
                ctx.content(ctx.param('setContent'));
            });
            bh.processBemJsonAsync({block: 'test'}).then(function (json) {
                json.content[0].content.should.equal('sync content');
                json.content[1].content.should.equal('async content');
                done();
            }).done();
        });
    });
});
