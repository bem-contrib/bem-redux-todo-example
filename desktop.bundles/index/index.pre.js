(function (global) {
  var babelHelpers = global.babelHelpers = {};

  babelHelpers.toConsumableArray = function (arr) {
    if (Array.isArray(arr)) {
      for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i];

      return arr2;
    } else {
      return Array.from(arr);
    }
  };
})(typeof global === "undefined" ? self : global);
/**
 * @module i-bem
 */

'use strict';

modules.define('i-bem', ['i-bem__internal', 'inherit', 'identify', 'next-tick', 'objects', 'functions', 'events'], function (provide, INTERNAL, inherit, identify, _nextTick, objects, functions, events) {

    var undef,
        MOD_DELIM = INTERNAL.MOD_DELIM,
        ELEM_DELIM = INTERNAL.ELEM_DELIM,

    /**
     * Storage for block init functions
     * @private
     * @type Array
     */
    initFns = [],

    /**
     * Storage for block declarations (hash by block name)
     * @private
     * @type Object
     */
    blocks = {};

    /**
     * Builds the name of the handler method for setting a modifier
     * @param {String} prefix
     * @param {String} modName Modifier name
     * @param {String} modVal Modifier value
     * @param {String} [elemName] Element name
     * @returns {String}
     */
    function buildModFnName(prefix, modName, modVal, elemName) {
        return '__' + prefix + (elemName ? '__elem_' + elemName : '') + '__mod' + (modName ? '_' + modName : '') + (modVal ? '_' + modVal : '');
    }

    /**
     * Transforms a hash of modifier handlers to methods
     * @param {String} prefix
     * @param {Object} modFns
     * @param {Object} props
     * @param {String} [elemName]
     */
    function modFnsToProps(prefix, modFns, props, elemName) {
        if (functions.isFunction(modFns)) {
            props[buildModFnName(prefix, '*', '*', elemName)] = modFns;
        } else {
            var modName, modVal, modFn;
            for (modName in modFns) {
                if (modFns.hasOwnProperty(modName)) {
                    modFn = modFns[modName];
                    if (functions.isFunction(modFn)) {
                        props[buildModFnName(prefix, modName, '*', elemName)] = modFn;
                    } else {
                        for (modVal in modFn) {
                            if (modFn.hasOwnProperty(modVal)) {
                                props[buildModFnName(prefix, modName, modVal, elemName)] = modFn[modVal];
                            }
                        }
                    }
                }
            }
        }
    }

    function buildCheckMod(modName, modVal) {
        return modVal ? Array.isArray(modVal) ? function (block) {
            var i = 0,
                len = modVal.length;
            while (i < len) if (block.hasMod(modName, modVal[i++])) return true;
            return false;
        } : function (block) {
            return block.hasMod(modName, modVal);
        } : function (block) {
            return block.hasMod(modName);
        };
    }

    function convertModHandlersToMethods(props) {
        if (props.beforeSetMod) {
            modFnsToProps('before', props.beforeSetMod, props);
            delete props.beforeSetMod;
        }

        if (props.onSetMod) {
            modFnsToProps('after', props.onSetMod, props);
            delete props.onSetMod;
        }

        var elemName;
        if (props.beforeElemSetMod) {
            for (elemName in props.beforeElemSetMod) {
                if (props.beforeElemSetMod.hasOwnProperty(elemName)) {
                    modFnsToProps('before', props.beforeElemSetMod[elemName], props, elemName);
                }
            }
            delete props.beforeElemSetMod;
        }

        if (props.onElemSetMod) {
            for (elemName in props.onElemSetMod) {
                if (props.onElemSetMod.hasOwnProperty(elemName)) {
                    modFnsToProps('after', props.onElemSetMod[elemName], props, elemName);
                }
            }
            delete props.onElemSetMod;
        }
    }

    /**
     * @class BEM
     * @description Base block for creating BEM blocks
     * @augments events:Emitter
     * @exports
     */
    var BEM = inherit(events.Emitter, /** @lends BEM.prototype */{
        /**
         * @constructor
         * @private
         * @param {Object} mods Block modifiers
         * @param {Object} params Block parameters
         * @param {Boolean} [initImmediately=true]
         */
        __constructor: function __constructor(mods, params, initImmediately) {
            /**
             * Cache of block modifiers
             * @member {Object}
             * @private
             */
            this._modCache = mods || {};

            /**
             * Current modifiers in the stack
             * @member {Object}
             * @private
             */
            this._processingMods = {};

            /**
             * Block parameters, taking into account the defaults
             * @member {Object}
             * @readonly
             */
            this.params = objects.extend(this.getDefaultParams(), params);

            initImmediately !== false ? this._init() : initFns.push(this._init, this);
        },

        /**
         * Initializes the block
         * @private
         */
        _init: function _init() {
            return this.setMod('js', 'inited');
        },

        /**
         * Adds an event handler
         * @param {String|Object} e Event type
         * @param {Object} [data] Additional data that the handler gets as e.data
         * @param {Function} fn Handler
         * @param {Object} [ctx] Handler context
         * @returns {BEM} this
         */
        on: function on(e, data, fn, ctx) {
            if (typeof e === 'object' && (functions.isFunction(data) || functions.isFunction(fn))) {
                // mod change event
                e = this.__self._buildModEventName(e);
            }

            return this.__base.apply(this, arguments);
        },

        /**
         * Removes event handler or handlers
         * @param {String|Object} [e] Event type
         * @param {Function} [fn] Handler
         * @param {Object} [ctx] Handler context
         * @returns {BEM} this
         */
        un: function un(e, fn, ctx) {
            if (typeof e === 'object' && functions.isFunction(fn)) {
                // mod change event
                e = this.__self._buildModEventName(e);
            }

            return this.__base.apply(this, arguments);
        },

        /**
         * Executes the block's event handlers and live event handlers
         * @protected
         * @param {String} e Event name
         * @param {Object} [data] Additional information
         * @returns {BEM} this
         */
        emit: function emit(e, data) {
            var isModJsEvent = false;
            if (typeof e === 'object' && !(e instanceof events.Event)) {
                isModJsEvent = e.modName === 'js';
                e = this.__self._buildModEventName(e);
            }

            if (isModJsEvent || this.hasMod('js', 'inited')) {
                this.__base(e = this._buildEvent(e), data);
                this._ctxEmit(e, data);
            }

            return this;
        },

        _ctxEmit: function _ctxEmit(e, data) {
            this.__self.emit(e, data);
        },

        /**
         * Builds event
         * @private
         * @param {String|events:Event} e
         * @returns {events:Event}
         */
        _buildEvent: function _buildEvent(e) {
            typeof e === 'string' ? e = new events.Event(e, this) : e.target || (e.target = this);

            return e;
        },

        /**
         * Checks whether a block or nested element has a modifier
         * @param {Object} [elem] Nested element
         * @param {String} modName Modifier name
         * @param {String|Boolean} [modVal] Modifier value. If defined and not of type String or Boolean, it is casted to String
         * @returns {Boolean}
         */
        hasMod: function hasMod(elem, modName, modVal) {
            var len = arguments.length,
                invert = false;

            if (len === 1) {
                modVal = '';
                modName = elem;
                elem = undef;
                invert = true;
            } else if (len === 2) {
                if (typeof elem === 'string') {
                    modVal = modName;
                    modName = elem;
                    elem = undef;
                } else {
                    modVal = '';
                    invert = true;
                }
            }

            var typeModVal = typeof modVal;
            typeModVal === 'string' || typeModVal === 'boolean' || typeModVal === 'undefined' || (modVal = modVal.toString());

            var res = this.getMod(elem, modName) === modVal;
            return invert ? !res : res;
        },

        /**
         * Returns the value of the modifier of the block/nested element
         * @param {Object} [elem] Nested element
         * @param {String} modName Modifier name
         * @returns {String|Boolean} Modifier value
         */
        getMod: function getMod(elem, modName) {
            var type = typeof elem;
            if (type === 'string' || type === 'undefined') {
                // elem either omitted or undefined
                modName = elem || modName;
                var modCache = this._modCache;
                return modName in modCache ? modCache[modName] || '' : modCache[modName] = this._extractModVal(modName);
            }

            return this._getElemMod(modName, elem);
        },

        /**
         * Returns the value of the modifier of the nested element
         * @private
         * @param {String} modName Modifier name
         * @param {Object} elem Nested element
         * @param {Object} [elemName] Nested element name
         * @returns {String} Modifier value
         */
        _getElemMod: function _getElemMod(modName, elem, elemName) {
            return this._extractModVal(modName, elem, elemName);
        },

        /**
         * Returns values of modifiers of the block/nested element
         * @param {Object} [elem] Nested element
         * @param {String} [...modNames] Modifier names
         * @returns {Object} Hash of modifier values
         */
        getMods: function getMods(elem) {
            var hasElem = elem && typeof elem !== 'string',
                modNames = [].slice.call(arguments, hasElem ? 1 : 0),
                res = this._extractMods(modNames, hasElem ? elem : undef);

            if (!hasElem) {
                // caching
                modNames.length ? modNames.forEach(function (name) {
                    this._modCache[name] = res[name];
                }, this) : this._modCache = res;
            }

            return res;
        },

        /**
         * Sets the modifier for a block/nested element
         * @param {Object} [elem] Nested element
         * @param {String} modName Modifier name
         * @param {String|Boolean} [modVal=true] Modifier value. If not of type String or Boolean, it is casted to String
         * @returns {BEM} this
         */
        setMod: function setMod(elem, modName, modVal) {
            if (typeof modVal === 'undefined') {
                if (typeof elem === 'string') {
                    // if no elem
                    modVal = typeof modName === 'undefined' ? true : // e.g. setMod('focused')
                    modName; // e.g. setMod('js', 'inited')
                    modName = elem;
                    elem = undef;
                } else {
                    // if elem
                    modVal = true; // e.g. setMod(elem, 'focused')
                }
            }

            if (!elem || elem[0]) {
                if (modVal === false) {
                    modVal = '';
                } else if (typeof modVal !== 'boolean') {
                    modVal = modVal.toString();
                }

                var modId = (elem && elem[0] ? identify(elem[0]) : '') + '_' + modName;

                if (this._processingMods[modId]) return this;

                var elemName,
                    curModVal = elem ? this._getElemMod(modName, elem, elemName = this.__self._extractElemNameFrom(elem)) : this.getMod(modName);

                if (curModVal === modVal) return this;

                this._processingMods[modId] = true;

                var needSetMod = true,
                    modFnParams = [modName, modVal, curModVal];

                elem && modFnParams.unshift(elem);

                var modVars = [['*', '*'], [modName, '*'], [modName, modVal]],
                    prefixes = ['before', 'after'],
                    i = 0,
                    prefix,
                    j,
                    modVar;

                while (prefix = prefixes[i++]) {
                    j = 0;
                    while (modVar = modVars[j++]) {
                        if (this._callModFn(prefix, elemName, modVar[0], modVar[1], modFnParams) === false) {
                            needSetMod = false;
                            break;
                        }
                    }

                    if (!needSetMod) break;

                    if (prefix === 'before') {
                        elem || (this._modCache[modName] = modVal); // cache only block mods
                        this._onSetMod(modName, modVal, curModVal, elem, elemName);
                    }
                }

                this._processingMods[modId] = null;
                needSetMod && this._emitModChangeEvents(modName, modVal, curModVal, elem, elemName);
            }

            return this;
        },

        /**
         * Function after successfully changing the modifier of the block/nested element
         * @protected
         * @param {String} modName Modifier name
         * @param {String} modVal Modifier value
         * @param {String} oldModVal Old modifier value
         * @param {Object} [elem] Nested element
         * @param {String} [elemName] Element name
         */
        _onSetMod: function _onSetMod(modName, modVal, oldModVal, elem, elemName) {},

        _emitModChangeEvents: function _emitModChangeEvents(modName, modVal, oldModVal, elem, elemName) {
            var eventData = { modName: modName, modVal: modVal, oldModVal: oldModVal };
            elem && (eventData.elem = elem);
            this.emit({ modName: modName, modVal: '*', elem: elemName }, eventData).emit({ modName: modName, modVal: modVal, elem: elemName }, eventData);
        },

        /**
         * Sets a modifier for a block/nested element, depending on conditions.
         * If the condition parameter is passed: when true, modVal1 is set; when false, modVal2 is set.
         * If the condition parameter is not passed: modVal1 is set if modVal2 was set, or vice versa.
         * @param {Object} [elem] Nested element
         * @param {String} modName Modifier name
         * @param {String} [modVal1=true] First modifier value, optional for boolean modifiers
         * @param {String} [modVal2] Second modifier value
         * @param {Boolean} [condition] Condition
         * @returns {BEM} this
         */
        toggleMod: function toggleMod(elem, modName, modVal1, modVal2, condition) {
            if (typeof elem === 'string') {
                // if this is a block
                condition = modVal2;
                modVal2 = modVal1;
                modVal1 = modName;
                modName = elem;
                elem = undef;
            }

            if (typeof modVal1 === 'undefined') {
                // boolean mod
                modVal1 = true;
            }

            if (typeof modVal2 === 'undefined') {
                modVal2 = '';
            } else if (typeof modVal2 === 'boolean') {
                condition = modVal2;
                modVal2 = '';
            }

            var modVal = this.getMod(elem, modName);
            (modVal === modVal1 || modVal === modVal2) && this.setMod(elem, modName, typeof condition === 'boolean' ? condition ? modVal1 : modVal2 : this.hasMod(elem, modName, modVal1) ? modVal2 : modVal1);

            return this;
        },

        /**
         * Removes a modifier from a block/nested element
         * @protected
         * @param {Object} [elem] Nested element
         * @param {String} modName Modifier name
         * @returns {BEM} this
         */
        delMod: function delMod(elem, modName) {
            if (!modName) {
                modName = elem;
                elem = undef;
            }

            return this.setMod(elem, modName, '');
        },

        /**
         * Executes handlers for setting modifiers
         * @private
         * @param {String} prefix
         * @param {String} elemName Element name
         * @param {String} modName Modifier name
         * @param {String} modVal Modifier value
         * @param {Array} modFnParams Handler parameters
         */
        _callModFn: function _callModFn(prefix, elemName, modName, modVal, modFnParams) {
            var modFnName = buildModFnName(prefix, modName, modVal, elemName);
            return this[modFnName] ? this[modFnName].apply(this, modFnParams) : undef;
        },

        /**
         * Retrieves the value of the modifier
         * @private
         * @param {String} modName Modifier name
         * @param {Object} [elem] Element
         * @returns {String} Modifier value
         */
        _extractModVal: function _extractModVal(modName, elem) {
            return '';
        },

        /**
         * Retrieves name/value for a list of modifiers
         * @private
         * @param {Array} modNames Names of modifiers
         * @param {Object} [elem] Element
         * @returns {Object} Hash of modifier values by name
         */
        _extractMods: function _extractMods(modNames, elem) {
            return {};
        },

        /**
         * Returns a block's default parameters
         * @protected
         * @returns {Object}
         */
        getDefaultParams: function getDefaultParams() {
            return {};
        },

        /**
         * Deletes a block
         * @private
         */
        _destruct: function _destruct() {
            this.delMod('js');
        },

        /**
         * Executes given callback on next turn eventloop in block's context
         * @protected
         * @param {Function} fn callback
         * @returns {BEM} this
         */
        nextTick: function nextTick(fn) {
            var _this = this;
            _nextTick(function () {
                _this.hasMod('js', 'inited') && fn.call(_this);
            });
            return this;
        }
    }, /** @lends BEM */{

        _name: 'i-bem',

        /**
         * Storage for block declarations (hash by block name)
         * @type Object
         */
        blocks: blocks,

        /**
         * Declares blocks and creates a block class
         * @param {String|Object} decl Block name (simple syntax) or description
         * @param {String} decl.block|decl.name Block name
         * @param {String} [decl.baseBlock] Name of the parent block
         * @param {Array} [decl.baseMix] Mixed block names
         * @param {String} [decl.modName] Modifier name
         * @param {String|Array} [decl.modVal] Modifier value
         * @param {Object} [props] Methods
         * @param {Object} [staticProps] Static methods
         * @returns {Function}
         */
        decl: function decl(_decl, props, staticProps) {
            // string as block
            typeof _decl === 'string' && (_decl = { block: _decl });
            // inherit from itself
            if (arguments.length <= 2 && typeof _decl === 'object' && (!_decl || typeof _decl.block !== 'string' && typeof _decl.modName !== 'string')) {
                staticProps = props;
                props = _decl;
                _decl = {};
            }
            typeof _decl.block === 'undefined' && (_decl.block = this.getName());

            var baseBlock;
            if (typeof _decl.baseBlock === 'undefined') {
                baseBlock = blocks[_decl.block] || this;
            } else if (typeof _decl.baseBlock === 'string') {
                baseBlock = blocks[_decl.baseBlock];
                if (!baseBlock) throw 'baseBlock "' + _decl.baseBlock + '" for "' + _decl.block + '" is undefined';
            } else {
                baseBlock = _decl.baseBlock;
            }

            convertModHandlersToMethods(props || (props = {}));

            if (_decl.modName) {
                var checkMod = buildCheckMod(_decl.modName, _decl.modVal);
                objects.each(props, function (prop, name) {
                    functions.isFunction(prop) && (props[name] = function () {
                        var method;
                        if (checkMod(this)) {
                            method = prop;
                        } else {
                            var baseMethod = baseBlock.prototype[name];
                            baseMethod && baseMethod !== prop && (method = this.__base);
                        }
                        return method ? method.apply(this, arguments) : undef;
                    });
                });
            }

            if (staticProps && typeof staticProps.live === 'boolean') {
                var live = staticProps.live;
                staticProps.live = function () {
                    return live;
                };
            }

            var block,
                baseBlocks = baseBlock;
            if (_decl.baseMix) {
                baseBlocks = [baseBlocks];
                _decl.baseMix.forEach(function (mixedBlock) {
                    if (!blocks[mixedBlock]) {
                        throw 'mix block "' + mixedBlock + '" for "' + _decl.block + '" is undefined';
                    }
                    baseBlocks.push(blocks[mixedBlock]);
                });
            }

            if (_decl.block === baseBlock.getName()) {
                // makes a new "live" if the old one was already executed
                (block = inherit.self(baseBlocks, props, staticProps))._processLive(true);
            } else {
                (block = blocks[_decl.block] = inherit(baseBlocks, props, staticProps))._name = _decl.block;
                delete block._liveInitable;
            }

            return block;
        },

        declMix: function declMix(block, props, staticProps) {
            convertModHandlersToMethods(props || (props = {}));
            return blocks[block] = inherit(props, staticProps);
        },

        /**
         * Processes a block's live properties
         * @private
         * @param {Boolean} [heedLive=false] Whether to take into account that the block already processed its live properties
         * @returns {Boolean} Whether the block is a live block
         */
        _processLive: function _processLive(heedLive) {
            return false;
        },

        /**
         * Factory method for creating an instance of the block named
         * @param {String|Object} block Block name or description
         * @param {Object} [params] Block parameters
         * @returns {BEM}
         */
        create: function create(block, params) {
            typeof block === 'string' && (block = { block: block });

            return new blocks[block.block](block.mods, params);
        },

        /**
         * Returns the name of the current block
         * @returns {String}
         */
        getName: function getName() {
            return this._name;
        },

        /**
         * Adds an event handler
         * @param {String|Object} e Event type
         * @param {Object} [data] Additional data that the handler gets as e.data
         * @param {Function} fn Handler
         * @param {Object} [ctx] Handler context
         * @returns {Function} this
         */
        on: function on(e, data, fn, ctx) {
            if (typeof e === 'object' && (functions.isFunction(data) || functions.isFunction(fn))) {
                // mod change event
                e = this._buildModEventName(e);
            }

            return this.__base.apply(this, arguments);
        },

        /**
         * Removes event handler or handlers
         * @param {String|Object} [e] Event type
         * @param {Function} [fn] Handler
         * @param {Object} [ctx] Handler context
         * @returns {Function} this
         */
        un: function un(e, fn, ctx) {
            if (typeof e === 'object' && functions.isFunction(fn)) {
                // mod change event
                e = this._buildModEventName(e);
            }

            return this.__base.apply(this, arguments);
        },

        _buildModEventName: function _buildModEventName(modEvent) {
            var res = MOD_DELIM + modEvent.modName + MOD_DELIM + (modEvent.modVal === false ? '' : modEvent.modVal);
            modEvent.elem && (res = ELEM_DELIM + modEvent.elem + res);
            return res;
        },

        /**
         * Retrieves the name of an element nested in a block
         * @private
         * @param {Object} elem Nested element
         * @returns {String|undefined}
         */
        _extractElemNameFrom: function _extractElemNameFrom(elem) {},

        /**
         * Executes the block init functions
         * @private
         */
        _runInitFns: function _runInitFns() {
            if (initFns.length) {
                var fns = initFns,
                    fn,
                    i = 0;

                initFns = [];
                while (fn = fns[i]) {
                    fn.call(fns[i + 1]);
                    i += 2;
                }
            }
        }
    });

    provide(BEM);
});
/**
 * @module i-bem__internal
 */

'use strict';

modules.define('i-bem__internal', function (provide) {

    var undef,

    /**
     * Separator for modifiers and their values
     * @const
     * @type String
     */
    MOD_DELIM = '_',

    /**
     * Separator between names of a block and a nested element
     * @const
     * @type String
     */
    ELEM_DELIM = '__',

    /**
     * Pattern for acceptable element and modifier names
     * @const
     * @type String
     */
    NAME_PATTERN = '[a-zA-Z0-9-]+';

    function isSimple(obj) {
        var typeOf = typeof obj;
        return typeOf === 'string' || typeOf === 'number' || typeOf === 'boolean';
    }

    function buildModPostfix(modName, modVal) {
        var res = '';
        /* jshint eqnull: true */
        if (modVal != null && modVal !== false) {
            res += MOD_DELIM + modName;
            modVal !== true && (res += MOD_DELIM + modVal);
        }
        return res;
    }

    function buildBlockClass(name, modName, modVal) {
        return name + buildModPostfix(modName, modVal);
    }

    function buildElemClass(block, name, modName, modVal) {
        return buildBlockClass(block, undef, undef) + ELEM_DELIM + name + buildModPostfix(modName, modVal);
    }

    provide( /** @exports */{
        NAME_PATTERN: NAME_PATTERN,

        MOD_DELIM: MOD_DELIM,
        ELEM_DELIM: ELEM_DELIM,

        buildModPostfix: buildModPostfix,

        /**
         * Builds the class of a block or element with a modifier
         * @param {String} block Block name
         * @param {String} [elem] Element name
         * @param {String} [modName] Modifier name
         * @param {String|Number} [modVal] Modifier value
         * @returns {String} Class
         */
        buildClass: function buildClass(block, elem, modName, modVal) {
            if (isSimple(modName)) {
                if (!isSimple(modVal)) {
                    modVal = modName;
                    modName = elem;
                    elem = undef;
                }
            } else if (typeof modName !== 'undefined') {
                modName = undef;
            } else if (elem && typeof elem !== 'string') {
                elem = undef;
            }

            if (!(elem || modName)) {
                // optimization for simple case
                return block;
            }

            return elem ? buildElemClass(block, elem, modName, modVal) : buildBlockClass(block, modName, modVal);
        },

        /**
         * Builds full classes for a buffer or element with modifiers
         * @param {String} block Block name
         * @param {String} [elem] Element name
         * @param {Object} [mods] Modifiers
         * @returns {String} Class
         */
        buildClasses: function buildClasses(block, elem, mods) {
            if (elem && typeof elem !== 'string') {
                mods = elem;
                elem = undef;
            }

            var res = elem ? buildElemClass(block, elem, undef, undef) : buildBlockClass(block, undef, undef);

            if (mods) {
                for (var modName in mods) {
                    if (mods.hasOwnProperty(modName) && mods[modName]) {
                        res += ' ' + (elem ? buildElemClass(block, elem, modName, mods[modName]) : buildBlockClass(block, modName, mods[modName]));
                    }
                }
            }

            return res;
        }
    });
});
/**
 * @module inherit
 * @version 2.2.1
 * @author Filatov Dmitry <dfilatov@yandex-team.ru>
 * @description This module provides some syntax sugar for "class" declarations, constructors, mixins, "super" calls and static members.
 */

'use strict';

(function (global) {

    var hasIntrospection = (function () {
        '_';
    }).toString().indexOf('_') > -1,
        emptyBase = function emptyBase() {},
        hasOwnProperty = Object.prototype.hasOwnProperty,
        objCreate = Object.create || function (ptp) {
        var inheritance = function inheritance() {};
        inheritance.prototype = ptp;
        return new inheritance();
    },
        objKeys = Object.keys || function (obj) {
        var res = [];
        for (var i in obj) {
            hasOwnProperty.call(obj, i) && res.push(i);
        }
        return res;
    },
        extend = function extend(o1, o2) {
        for (var i in o2) {
            hasOwnProperty.call(o2, i) && (o1[i] = o2[i]);
        }

        return o1;
    },
        toStr = Object.prototype.toString,
        isArray = Array.isArray || function (obj) {
        return toStr.call(obj) === '[object Array]';
    },
        isFunction = function isFunction(obj) {
        return toStr.call(obj) === '[object Function]';
    },
        noOp = function noOp() {},
        needCheckProps = true,
        testPropObj = { toString: '' };

    for (var i in testPropObj) {
        // fucking ie hasn't toString, valueOf in for
        testPropObj.hasOwnProperty(i) && (needCheckProps = false);
    }

    var specProps = needCheckProps ? ['toString', 'valueOf'] : null;

    function getPropList(obj) {
        var res = objKeys(obj);
        if (needCheckProps) {
            var specProp,
                i = 0;
            while (specProp = specProps[i++]) {
                obj.hasOwnProperty(specProp) && res.push(specProp);
            }
        }

        return res;
    }

    function override(base, res, add) {
        var addList = getPropList(add),
            j = 0,
            len = addList.length,
            name,
            prop;
        while (j < len) {
            if ((name = addList[j++]) === '__self') {
                continue;
            }
            prop = add[name];
            if (isFunction(prop) && (!hasIntrospection || prop.toString().indexOf('.__base') > -1)) {
                res[name] = (function (name, prop) {
                    var baseMethod = base[name] ? base[name] : name === '__constructor' ? // case of inheritance from plane function
                    res.__self.__parent : noOp;
                    return function () {
                        var baseSaved = this.__base;
                        this.__base = baseMethod;
                        var res = prop.apply(this, arguments);
                        this.__base = baseSaved;
                        return res;
                    };
                })(name, prop);
            } else {
                res[name] = prop;
            }
        }
    }

    function applyMixins(mixins, res) {
        var i = 1,
            mixin;
        while (mixin = mixins[i++]) {
            res ? isFunction(mixin) ? inherit.self(res, mixin.prototype, mixin) : inherit.self(res, mixin) : res = isFunction(mixin) ? inherit(mixins[0], mixin.prototype, mixin) : inherit(mixins[0], mixin);
        }
        return res || mixins[0];
    }

    /**
    * Creates class
    * @exports
    * @param {Function|Array} [baseClass|baseClassAndMixins] class (or class and mixins) to inherit from
    * @param {Object} prototypeFields
    * @param {Object} [staticFields]
    * @returns {Function} class
    */
    function inherit() {
        var args = arguments,
            withMixins = isArray(args[0]),
            hasBase = withMixins || isFunction(args[0]),
            base = hasBase ? withMixins ? applyMixins(args[0]) : args[0] : emptyBase,
            props = args[hasBase ? 1 : 0] || {},
            staticProps = args[hasBase ? 2 : 1],
            res = props.__constructor || hasBase && base.prototype.__constructor ? function () {
            return this.__constructor.apply(this, arguments);
        } : hasBase ? function () {
            return base.apply(this, arguments);
        } : function () {};

        if (!hasBase) {
            res.prototype = props;
            res.prototype.__self = res.prototype.constructor = res;
            return extend(res, staticProps);
        }

        extend(res, base);

        res.__parent = base;

        var basePtp = base.prototype,
            resPtp = res.prototype = objCreate(basePtp);

        resPtp.__self = resPtp.constructor = res;

        props && override(basePtp, resPtp, props);
        staticProps && override(base, res, staticProps);

        return res;
    }

    inherit.self = function () {
        var args = arguments,
            withMixins = isArray(args[0]),
            base = withMixins ? applyMixins(args[0], args[0][0]) : args[0],
            props = args[1],
            staticProps = args[2],
            basePtp = base.prototype;

        props && override(basePtp, basePtp, props);
        staticProps && override(base, base, staticProps);

        return base;
    };

    var defineAsGlobal = true;
    if (typeof exports === 'object') {
        module.exports = inherit;
        defineAsGlobal = false;
    }

    if (typeof modules === 'object') {
        modules.define('inherit', function (provide) {
            provide(inherit);
        });
        defineAsGlobal = false;
    }

    if (typeof define === 'function') {
        define(function (require, exports, module) {
            module.exports = inherit;
        });
        defineAsGlobal = false;
    }

    defineAsGlobal && (global.inherit = inherit);
})(undefined);
/**
 * @module identify
 */

'use strict';

modules.define('identify', function (provide) {

    var counter = 0,
        expando = '__' + +new Date(),
        get = function get() {
        return 'uniq' + ++counter;
    };

    provide(
    /**
     * Makes unique ID
     * @exports
     * @param {Object} obj Object that needs to be identified
     * @param {Boolean} [onlyGet=false] Return a unique value only if it had already been assigned before
     * @returns {String} ID
     */
    function (obj, onlyGet) {
        if (!obj) return get();

        var key = 'uniqueID' in obj ? 'uniqueID' : expando; // Use when possible native uniqueID for elements in IE

        return onlyGet || key in obj ? obj[key] : obj[key] = get();
    });
});
/**
 * @module next-tick
 */

'use strict';

modules.define('next-tick', function (provide) {

    /**
     * Executes given function on next tick.
     * @exports
     * @type Function
     * @param {Function} fn
     */

    var global = this.global,
        fns = [],
        enqueueFn = function enqueueFn(fn) {
        return fns.push(fn) === 1;
    },
        callFns = function callFns() {
        var fnsToCall = fns,
            i = 0,
            len = fns.length;
        fns = [];
        while (i < len) {
            fnsToCall[i++]();
        }
    };

    /* global process */
    if (typeof process === 'object' && process.nextTick) {
        // nodejs
        return provide(function (fn) {
            enqueueFn(fn) && process.nextTick(callFns);
        });
    }

    if (global.setImmediate) {
        // ie10
        return provide(function (fn) {
            enqueueFn(fn) && global.setImmediate(callFns);
        });
    }

    if (global.postMessage) {
        // modern browsers
        var isPostMessageAsync = true;
        if (global.attachEvent) {
            var checkAsync = function checkAsync() {
                isPostMessageAsync = false;
            };
            global.attachEvent('onmessage', checkAsync);
            global.postMessage('__checkAsync', '*');
            global.detachEvent('onmessage', checkAsync);
        }

        if (isPostMessageAsync) {
            var msg = '__nextTick' + +new Date(),
                onMessage = function onMessage(e) {
                if (e.data === msg) {
                    e.stopPropagation && e.stopPropagation();
                    callFns();
                }
            };

            global.addEventListener ? global.addEventListener('message', onMessage, true) : global.attachEvent('onmessage', onMessage);

            return provide(function (fn) {
                enqueueFn(fn) && global.postMessage(msg, '*');
            });
        }
    }

    var doc = global.document;
    if ('onreadystatechange' in doc.createElement('script')) {
        // ie6-ie8
        var head = doc.getElementsByTagName('head')[0],
            createScript = function createScript() {
            var script = doc.createElement('script');
            script.onreadystatechange = function () {
                script.parentNode.removeChild(script);
                script = script.onreadystatechange = null;
                callFns();
            };
            head.appendChild(script);
        };

        return provide(function (fn) {
            enqueueFn(fn) && createScript();
        });
    }

    provide(function (fn) {
        // old browsers
        enqueueFn(fn) && global.setTimeout(callFns, 0);
    });
});
/**
 * @module objects
 * @description A set of helpers to work with JavaScript objects
 */

'use strict';

modules.define('objects', function (provide) {

    var hasOwnProp = Object.prototype.hasOwnProperty;

    provide( /** @exports */{
        /**
         * Extends a given target by
         * @param {Object} target object to extend
         * @param {Object} source
         * @returns {Object}
         */
        extend: function extend(target, source) {
            (typeof target !== 'object' || target === null) && (target = {});

            for (var i = 1, len = arguments.length; i < len; i++) {
                var obj = arguments[i];
                if (obj) {
                    for (var key in obj) {
                        hasOwnProp.call(obj, key) && (target[key] = obj[key]);
                    }
                }
            }

            return target;
        },

        /**
         * Check whether a given object is empty (contains no enumerable properties)
         * @param {Object} obj
         * @returns {Boolean}
         */
        isEmpty: function isEmpty(obj) {
            for (var key in obj) {
                if (hasOwnProp.call(obj, key)) {
                    return false;
                }
            }

            return true;
        },

        /**
         * Generic iterator function over object
         * @param {Object} obj object to iterate
         * @param {Function} fn callback
         * @param {Object} [ctx] callbacks's context
         */
        each: function each(obj, fn, ctx) {
            for (var key in obj) {
                if (hasOwnProp.call(obj, key)) {
                    ctx ? fn.call(ctx, obj[key], key) : fn(obj[key], key);
                }
            }
        }
    });
});
/**
 * @module functions
 * @description A set of helpers to work with JavaScript functions
 */

'use strict';

modules.define('functions', function (provide) {

  var toStr = Object.prototype.toString;

  provide( /** @exports */{
    /**
     * Checks whether a given object is function
     * @param {*} obj
     * @returns {Boolean}
     */
    isFunction: function isFunction(obj) {
      return toStr.call(obj) === '[object Function]';
    },

    /**
     * Empty function
     */
    noop: function noop() {}
  });
});
/**
 * @module events
 */

'use strict';

modules.define('events', ['identify', 'inherit', 'functions'], function (provide, identify, inherit, functions) {

    var undef,
        storageExpando = '__' + +new Date() + 'storage',
        getFnId = function getFnId(fn, ctx) {
        return identify(fn) + (ctx ? identify(ctx) : '');
    },

    /**
     * @class Event
     * @exports events:Event
     */
    Event = inherit( /** @lends Event.prototype */{
        /**
         * @constructor
         * @param {String} type
         * @param {Object} target
         */
        __constructor: function __constructor(type, target) {
            /**
             * Type
             * @member {String}
             */
            this.type = type;

            /**
             * Target
             * @member {Object}
             */
            this.target = target;

            /**
             * Result
             * @member {*}
             */
            this.result = undef;

            /**
             * Data
             * @member {*}
             */
            this.data = undef;

            this._isDefaultPrevented = false;
            this._isPropagationStopped = false;
        },

        /**
         * Prevents default action
         */
        preventDefault: function preventDefault() {
            this._isDefaultPrevented = true;
        },

        /**
         * Returns whether is default action prevented
         * @returns {Boolean}
         */
        isDefaultPrevented: function isDefaultPrevented() {
            return this._isDefaultPrevented;
        },

        /**
         * Stops propagation
         */
        stopPropagation: function stopPropagation() {
            this._isPropagationStopped = true;
        },

        /**
         * Returns whether is propagation stopped
         * @returns {Boolean}
         */
        isPropagationStopped: function isPropagationStopped() {
            return this._isPropagationStopped;
        }
    }),

    /**
     * @lends Emitter
     * @lends Emitter.prototype
     */
    EmitterProps = {
        /**
         * Adds an event handler
         * @param {String} e Event type
         * @param {Object} [data] Additional data that the handler gets as e.data
         * @param {Function} fn Handler
         * @param {Object} [ctx] Handler context
         * @returns {Emitter} this
         */
        on: function on(e, data, fn, ctx, _special) {
            if (typeof e === 'string') {
                if (functions.isFunction(data)) {
                    ctx = fn;
                    fn = data;
                    data = undef;
                }

                var id = getFnId(fn, ctx),
                    storage = this[storageExpando] || (this[storageExpando] = {}),
                    eventTypes = e.split(' '),
                    eventType,
                    i = 0,
                    list,
                    item,
                    eventStorage;

                while (eventType = eventTypes[i++]) {
                    eventStorage = storage[eventType] || (storage[eventType] = { ids: {}, list: {} });
                    if (!(id in eventStorage.ids)) {
                        list = eventStorage.list;
                        item = { fn: fn, data: data, ctx: ctx, special: _special };
                        if (list.last) {
                            list.last.next = item;
                            item.prev = list.last;
                        } else {
                            list.first = item;
                        }
                        eventStorage.ids[id] = list.last = item;
                    }
                }
            } else {
                for (var key in e) {
                    e.hasOwnProperty(key) && this.on(key, e[key], data, _special);
                }
            }

            return this;
        },

        /**
         * Adds a one time handler for the event.
         * Handler is executed only the next time the event is fired, after which it is removed.
         * @param {String} e Event type
         * @param {Object} [data] Additional data that the handler gets as e.data
         * @param {Function} fn Handler
         * @param {Object} [ctx] Handler context
         * @returns {Emitter} this
         */
        once: function once(e, data, fn, ctx) {
            return this.on(e, data, fn, ctx, { once: true });
        },

        /**
         * Removes event handler or handlers
         * @param {String} [e] Event type
         * @param {Function} [fn] Handler
         * @param {Object} [ctx] Handler context
         * @returns {Emitter} this
         */
        un: function un(e, fn, ctx) {
            if (typeof e === 'string' || typeof e === 'undefined') {
                var storage = this[storageExpando];
                if (storage) {
                    if (e) {
                        // if event type was passed
                        var eventTypes = e.split(' '),
                            i = 0,
                            eventStorage;
                        while (e = eventTypes[i++]) {
                            if (eventStorage = storage[e]) {
                                if (fn) {
                                    // if specific handler was passed
                                    var id = getFnId(fn, ctx),
                                        ids = eventStorage.ids;
                                    if (id in ids) {
                                        var list = eventStorage.list,
                                            item = ids[id],
                                            prev = item.prev,
                                            next = item.next;

                                        if (prev) {
                                            prev.next = next;
                                        } else if (item === list.first) {
                                            list.first = next;
                                        }

                                        if (next) {
                                            next.prev = prev;
                                        } else if (item === list.last) {
                                            list.last = prev;
                                        }

                                        delete ids[id];
                                    }
                                } else {
                                    delete this[storageExpando][e];
                                }
                            }
                        }
                    } else {
                        delete this[storageExpando];
                    }
                }
            } else {
                for (var key in e) {
                    e.hasOwnProperty(key) && this.un(key, e[key], fn);
                }
            }

            return this;
        },

        /**
         * Fires event handlers
         * @param {String|events:Event} e Event
         * @param {Object} [data] Additional data
         * @returns {Emitter} this
         */
        emit: function emit(e, data) {
            var storage = this[storageExpando],
                eventInstantiated = false;

            if (storage) {
                var eventTypes = [typeof e === 'string' ? e : e.type, '*'],
                    i = 0,
                    eventType,
                    eventStorage;
                while (eventType = eventTypes[i++]) {
                    if (eventStorage = storage[eventType]) {
                        var item = eventStorage.list.first,
                            lastItem = eventStorage.list.last,
                            res;
                        while (item) {
                            if (!eventInstantiated) {
                                // instantiate Event only on demand
                                eventInstantiated = true;
                                typeof e === 'string' && (e = new Event(e));
                                e.target || (e.target = this);
                            }

                            e.data = item.data;
                            res = item.fn.apply(item.ctx || this, arguments);
                            if (typeof res !== 'undefined') {
                                e.result = res;
                                if (res === false) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                }
                            }

                            item.special && item.special.once && this.un(e.type, item.fn, item.ctx);

                            if (item === lastItem) {
                                break;
                            }

                            item = item.next;
                        }
                    }
                }
            }

            return this;
        }
    },

    /**
     * @class Emitter
     * @exports events:Emitter
     */
    Emitter = inherit(EmitterProps, EmitterProps);

    provide({
        Emitter: Emitter,
        Event: Event
    });
});
/**
 * @module i-bem__dom
 */

'use strict';

modules.define('i-bem__dom', ['i-bem', 'i-bem__internal', 'identify', 'objects', 'functions', 'jquery', 'dom'], function (provide, BEM, INTERNAL, identify, objects, functions, $, dom) {

    var undef,
        win = $(window),
        doc = $(document),

    /**
     * Storage for DOM elements by unique key
     * @type Object
     */
    uniqIdToDomElems = {},

    /**
     * Storage for blocks by unique key
     * @type Object
     */
    uniqIdToBlock = {},

    /**
     * Storage for DOM element's parent nodes
     * @type Object
     */
    domNodesToParents = {},

    /**
     * Storage for block parameters
     * @type Object
     */
    domElemToParams = {},

    /**
     * Storage for liveCtx event handlers
     * @type Object
     */
    liveEventCtxStorage = {},

    /**
     * Storage for liveClass event handlers
     * @type Object
     */
    liveClassEventStorage = {},
        blocks = BEM.blocks,
        BEM_CLASS = 'i-bem',
        BEM_SELECTOR = '.' + BEM_CLASS,
        BEM_PARAMS_ATTR = 'data-bem',
        NAME_PATTERN = INTERNAL.NAME_PATTERN,
        MOD_DELIM = INTERNAL.MOD_DELIM,
        ELEM_DELIM = INTERNAL.ELEM_DELIM,
        EXTRACT_MODS_RE = RegExp('[^' + MOD_DELIM + ']' + MOD_DELIM + '(' + NAME_PATTERN + ')' + '(?:' + MOD_DELIM + '(' + NAME_PATTERN + '))?$'),
        buildModPostfix = INTERNAL.buildModPostfix,
        _buildClass = INTERNAL.buildClass,
        reverse = Array.prototype.reverse;

    /**
     * Initializes blocks on a DOM element
     * @param {jQuery} domElem DOM element
     * @param {String} uniqInitId ID of the "initialization wave"
     */
    function initBlocks(domElem, uniqInitId) {
        var domNode = domElem[0],
            params = getParams(domNode),
            blockName;

        for (blockName in params) initBlock(blockName, domElem, processParams(params[blockName], blockName, uniqInitId));
    }

    /**
     * Initializes a specific block on a DOM element, or returns the existing block if it was already created
     * @param {String} blockName Block name
     * @param {jQuery} domElem DOM element
     * @param {Object} [params] Initialization parameters
     * @param {Boolean} [forceLive=false] Force live initialization
     * @param {Function} [callback] Handler to call after complete initialization
     */
    function initBlock(blockName, domElem, params, forceLive, callback) {
        var domNode = domElem[0];

        params || (params = processParams(getBlockParams(domNode, blockName), blockName));

        var uniqId = params.uniqId,
            block = uniqIdToBlock[uniqId];

        if (block) {
            if (block.domElem.index(domNode) < 0) {
                block.domElem = block.domElem.add(domElem);
                objects.extend(block.params, params);
            }

            return block;
        }

        uniqIdToDomElems[uniqId] = uniqIdToDomElems[uniqId] ? uniqIdToDomElems[uniqId].add(domElem) : domElem;

        var parentDomNode = domNode.parentNode;
        if (!parentDomNode || parentDomNode.nodeType === 11) {
            // jquery doesn't unique disconnected node
            $.unique(uniqIdToDomElems[uniqId]);
        }

        var blockClass = blocks[blockName] || DOM.decl(blockName, {}, { live: true }, true);
        if (!(blockClass._liveInitable = !!blockClass._processLive()) || forceLive || params.live === false) {
            forceLive && domElem.addClass(BEM_CLASS); // add css class for preventing memory leaks in further destructing

            block = new blockClass(uniqIdToDomElems[uniqId], params, !!forceLive);

            delete uniqIdToDomElems[uniqId];
            callback && callback.apply(block, Array.prototype.slice.call(arguments, 4));
            return block;
        }
    }

    /**
     * Processes and adds necessary block parameters
     * @param {Object} params Initialization parameters
     * @param {String} blockName Block name
     * @param {String} [uniqInitId] ID of the "initialization wave"
     */
    function processParams(params, blockName, uniqInitId) {
        params.uniqId || (params.uniqId = (params.id ? blockName + '-id-' + params.id : identify()) + (uniqInitId || identify()));

        return params;
    }

    /**
     * Helper for searching for a DOM element using a selector inside the context, including the context itself
     * @param {jQuery} ctx Context
     * @param {String} selector CSS selector
     * @param {Boolean} [excludeSelf=false] Exclude context from search
     * @returns {jQuery}
     */
    function findDomElem(ctx, selector, excludeSelf) {
        var res = ctx.find(selector);
        return excludeSelf ? res : res.add(ctx.filter(selector));
    }

    /**
     * Returns parameters of a block's DOM element
     * @param {HTMLElement} domNode DOM node
     * @returns {Object}
     */
    function getParams(domNode, blockName) {
        var uniqId = identify(domNode);
        return domElemToParams[uniqId] || (domElemToParams[uniqId] = extractParams(domNode));
    }

    /**
     * Returns parameters of a block extracted from DOM node
     * @param {HTMLElement} domNode DOM node
     * @param {String} blockName
     * @returns {Object}
     */

    function getBlockParams(domNode, blockName) {
        var params = getParams(domNode);
        return params[blockName] || (params[blockName] = {});
    }

    /**
     * Retrieves block parameters from a DOM element
     * @param {HTMLElement} domNode DOM node
     * @returns {Object}
     */
    function extractParams(domNode) {
        var attrVal = domNode.getAttribute(BEM_PARAMS_ATTR);
        return attrVal ? JSON.parse(attrVal) : {};
    }

    /**
     * Uncouple DOM node from the block. If this is the last node, then destroys the block.
     * @param {BEMDOM} block block
     * @param {HTMLElement} domNode DOM node
     */
    function removeDomNodeFromBlock(block, domNode) {
        block.domElem.length === 1 ? block._destruct() : block.domElem = block.domElem.not(domNode);
    }

    /**
     * Fills DOM node's parent nodes to the storage
     * @param {jQuery} domElem
     */
    function storeDomNodeParents(domElem) {
        domElem.each(function () {
            domNodesToParents[identify(this)] = this.parentNode;
        });
    }

    /**
     * Returns jQuery collection for provided HTML
     * @param {jQuery|String} html
     * @returns {jQuery}
     */
    function getJqueryCollection(html) {
        return $(typeof html === 'string' ? $.parseHTML(html, null, true) : html);
    }

    var DOM;

    $(function () {

        /**
         * @class BEMDOM
         * @description Base block for creating BEM blocks that have DOM representation
         * @exports
         */

        DOM = BEM.decl('i-bem__dom', /** @lends BEMDOM.prototype */{
            /**
             * @constructor
             * @private
             * @param {jQuery} domElem DOM element that the block is created on
             * @param {Object} params Block parameters
             * @param {Boolean} [initImmediately=true]
             */
            __constructor: function __constructor(domElem, params, initImmediately) {
                /**
                 * DOM elements of block
                 * @member {jQuery}
                 * @readonly
                 */
                this.domElem = domElem;

                /**
                 * Cache for names of events on DOM elements
                 * @member {Object}
                 * @private
                 */
                this._eventNameCache = {};

                /**
                 * Cache for elements
                 * @member {Object}
                 * @private
                 */
                this._elemCache = {};

                /**
                 * @member {String} Unique block ID
                 * @private
                 */
                this._uniqId = params.uniqId;

                uniqIdToBlock[this._uniqId] = this;

                /**
                 * @member {Boolean} Flag for whether it's necessary to unbind from the document and window when destroying the block
                 * @private
                 */
                this._needSpecialUnbind = false;

                this.__base(null, params, initImmediately);
            },

            /**
             * Finds blocks inside the current block or its elements (including context)
             * @param {String|jQuery} [elem] Block element
             * @param {String|Object} block Name or description (block,modName,modVal) of the block to find
             * @returns {BEMDOM[]}
             */
            findBlocksInside: function findBlocksInside(elem, block) {
                return this._findBlocks('find', elem, block);
            },

            /**
             * Finds the first block inside the current block or its elements (including context)
             * @param {String|jQuery} [elem] Block element
             * @param {String|Object} block Name or description (block,modName,modVal) of the block to find
             * @returns {BEMDOM}
             */
            findBlockInside: function findBlockInside(elem, block) {
                return this._findBlocks('find', elem, block, true);
            },

            /**
             * Finds blocks outside the current block or its elements (including context)
             * @param {String|jQuery} [elem] Block element
             * @param {String|Object} block Name or description (block,modName,modVal) of the block to find
             * @returns {BEMDOM[]}
             */
            findBlocksOutside: function findBlocksOutside(elem, block) {
                return this._findBlocks('parents', elem, block);
            },

            /**
             * Finds the first block outside the current block or its elements (including context)
             * @param {String|jQuery} [elem] Block element
             * @param {String|Object} block Name or description (block,modName,modVal) of the block to find
             * @returns {BEMDOM}
             */
            findBlockOutside: function findBlockOutside(elem, block) {
                return this._findBlocks('closest', elem, block)[0] || null;
            },

            /**
             * Finds blocks on DOM elements of the current block or its elements
             * @param {String|jQuery} [elem] Block element
             * @param {String|Object} block Name or description (block,modName,modVal) of the block to find
             * @returns {BEMDOM[]}
             */
            findBlocksOn: function findBlocksOn(elem, block) {
                return this._findBlocks('', elem, block);
            },

            /**
             * Finds the first block on DOM elements of the current block or its elements
             * @param {String|jQuery} [elem] Block element
             * @param {String|Object} block Name or description (block,modName,modVal) of the block to find
             * @returns {BEMDOM}
             */
            findBlockOn: function findBlockOn(elem, block) {
                return this._findBlocks('', elem, block, true);
            },

            _findBlocks: function _findBlocks(select, elem, block, onlyFirst) {
                if (!block) {
                    block = elem;
                    elem = undef;
                }

                var ctxElem = elem ? typeof elem === 'string' ? this.findElem(elem) : elem : this.domElem,
                    isSimpleBlock = typeof block === 'string',
                    blockName = isSimpleBlock ? block : block.block || block.blockName,
                    selector = '.' + (isSimpleBlock ? _buildClass(blockName) : _buildClass(blockName, block.modName, block.modVal)) + (onlyFirst ? ':first' : ''),
                    domElems = ctxElem.filter(selector);

                select && (domElems = domElems.add(ctxElem[select](selector)));

                if (onlyFirst) {
                    return domElems[0] ? initBlock(blockName, domElems.eq(0), undef, true)._init() : null;
                }

                var res = [],
                    uniqIds = {};

                domElems.each(function (i, domElem) {
                    var block = initBlock(blockName, $(domElem), undef, true)._init();
                    if (!uniqIds[block._uniqId]) {
                        uniqIds[block._uniqId] = true;
                        res.push(block);
                    }
                });

                return res;
            },

            /**
             * Adds an event handler for any DOM element
             * @protected
             * @param {jQuery} domElem DOM element where the event will be listened for
             * @param {String|Object} event Event name or event object
             * @param {Object} [data] Additional event data
             * @param {Function} fn Handler function, which will be executed in the block's context
             * @returns {BEMDOM} this
             */
            bindToDomElem: function bindToDomElem(domElem, event, data, fn) {
                if (functions.isFunction(data)) {
                    fn = data;
                    data = undef;
                }

                fn ? domElem.bind(this._buildEventName(event), data, $.proxy(fn, this)) : objects.each(event, function (fn, event) {
                    this.bindToDomElem(domElem, event, data, fn);
                }, this);

                return this;
            },

            /**
             * Adds an event handler to the document
             * @protected
             * @param {String|Object} event Event name or event object
             * @param {Object} [data] Additional event data
             * @param {Function} fn Handler function, which will be executed in the block's context
             * @returns {BEMDOM} this
             */
            bindToDoc: function bindToDoc(event, data, fn) {
                this._needSpecialUnbind = true;
                return this.bindToDomElem(doc, event, data, fn);
            },

            /**
             * Adds an event handler to the window
             * @protected
             * @param {String|Object} event Event name or event object
             * @param {Object} [data] Additional event data
             * @param {Function} fn Handler function, which will be executed in the block's context
             * @returns {BEMDOM} this
             */
            bindToWin: function bindToWin(event, data, fn) {
                this._needSpecialUnbind = true;
                return this.bindToDomElem(win, event, data, fn);
            },

            /**
             * Adds an event handler to the block's main DOM elements or its nested elements
             * @protected
             * @param {jQuery|String} [elem] Element
             * @param {String|Object} event Event name or event object
             * @param {Object} [data] Additional event data
             * @param {Function} fn Handler function, which will be executed in the block's context
             * @returns {BEMDOM} this
             */
            bindTo: function bindTo(elem, event, data, fn) {
                var len = arguments.length;
                if (len === 3) {
                    if (functions.isFunction(data)) {
                        fn = data;
                        if (typeof event === 'object') {
                            data = event;
                            event = elem;
                            elem = this.domElem;
                        }
                    }
                } else if (len === 2) {
                    if (functions.isFunction(event)) {
                        fn = event;
                        event = elem;
                        elem = this.domElem;
                    } else if (!(typeof elem === 'string' || elem instanceof $)) {
                        data = event;
                        event = elem;
                        elem = this.domElem;
                    }
                } else if (len === 1) {
                    event = elem;
                    elem = this.domElem;
                }

                typeof elem === 'string' && (elem = this.elem(elem));

                return this.bindToDomElem(elem, event, data, fn);
            },

            /**
             * Removes event handlers from any DOM element
             * @protected
             * @param {jQuery} domElem DOM element where the event was being listened for
             * @param {String|Object} event Event name or event object
             * @param {Function} [fn] Handler function
             * @returns {BEMDOM} this
             */
            unbindFromDomElem: function unbindFromDomElem(domElem, event, fn) {
                if (typeof event === 'string') {
                    event = this._buildEventName(event);
                    fn ? domElem.unbind(event, fn) : domElem.unbind(event);
                } else {
                    objects.each(event, function (fn, event) {
                        this.unbindFromDomElem(domElem, event, fn);
                    }, this);
                }

                return this;
            },

            /**
             * Removes event handler from document
             * @protected
             * @param {String|Object} event Event name or event object
             * @param {Function} [fn] Handler function
             * @returns {BEMDOM} this
             */
            unbindFromDoc: function unbindFromDoc(event, fn) {
                return this.unbindFromDomElem(doc, event, fn);
            },

            /**
             * Removes event handler from window
             * @protected
             * @param {String|Object} event Event name or event object
             * @param {Function} [fn] Handler function
             * @returns {BEMDOM} this
             */
            unbindFromWin: function unbindFromWin(event, fn) {
                return this.unbindFromDomElem(win, event, fn);
            },

            /**
             * Removes event handlers from the block's main DOM elements or its nested elements
             * @protected
             * @param {jQuery|String} [elem] Nested element
             * @param {String|Object} event Event name or event object
             * @param {Function} [fn] Handler function
             * @returns {BEMDOM} this
             */
            unbindFrom: function unbindFrom(elem, event, fn) {
                var argLen = arguments.length;
                if (argLen === 1) {
                    event = elem;
                    elem = this.domElem;
                } else if (argLen === 2 && functions.isFunction(event)) {
                    fn = event;
                    event = elem;
                    elem = this.domElem;
                } else if (typeof elem === 'string') {
                    elem = this.elem(elem);
                }

                return this.unbindFromDomElem(elem, event, fn);
            },

            /**
             * Builds a full name for an event
             * @private
             * @param {String} event Event name
             * @returns {String}
             */
            _buildEventName: function _buildEventName(event) {
                return event.indexOf(' ') > 1 ? event.split(' ').map(function (e) {
                    return this._buildOneEventName(e);
                }, this).join(' ') : this._buildOneEventName(event);
            },

            /**
             * Builds a full name for a single event
             * @private
             * @param {String} event Event name
             * @returns {String}
             */
            _buildOneEventName: function _buildOneEventName(event) {
                var eventNameCache = this._eventNameCache;

                if (event in eventNameCache) return eventNameCache[event];

                var uniq = '.' + this._uniqId;

                if (event.indexOf('.') < 0) return eventNameCache[event] = event + uniq;

                var lego = '.bem_' + this.__self._name;

                return eventNameCache[event] = event.split('.').map(function (e, i) {
                    return i === 0 ? e + lego : lego + '_' + e;
                }).join('') + uniq;
            },

            _ctxEmit: function _ctxEmit(e, data) {
                this.__base.apply(this, arguments);

                var _this = this,
                    storage = liveEventCtxStorage[_this.__self._buildCtxEventName(e.type)],
                    ctxIds = {};

                storage && _this.domElem.each(function (_, ctx) {
                    var counter = storage.counter;
                    while (ctx && counter) {
                        var ctxId = identify(ctx, true);
                        if (ctxId) {
                            if (ctxIds[ctxId]) break;
                            var storageCtx = storage.ctxs[ctxId];
                            if (storageCtx) {
                                objects.each(storageCtx, function (handler) {
                                    handler.fn.call(handler.ctx || _this, e, data);
                                });
                                counter--;
                            }
                            ctxIds[ctxId] = true;
                        }
                        ctx = ctx.parentNode || domNodesToParents[ctxId];
                    }
                });
            },

            /**
             * Sets a modifier for a block/nested element
             * @param {jQuery} [elem] Nested element
             * @param {String} modName Modifier name
             * @param {String} modVal Modifier value
             * @returns {BEMDOM} this
             */
            setMod: function setMod(elem, modName, modVal) {
                if (elem && typeof modVal !== 'undefined' && elem.length > 1) {
                    var _this = this;
                    elem.each(function () {
                        var item = $(this);
                        item.__bemElemName = elem.__bemElemName;
                        _this.setMod(item, modName, modVal);
                    });
                    return _this;
                }
                return this.__base(elem, modName, modVal);
            },

            /**
             * Retrieves modifier value from the DOM node's CSS class
             * @private
             * @param {String} modName Modifier name
             * @param {jQuery} [elem] Nested element
             * @param {String} [elemName] Name of the nested element
             * @returns {String} Modifier value
             */
            _extractModVal: function _extractModVal(modName, elem, elemName) {
                var domNode = (elem || this.domElem)[0],
                    matches;

                domNode && (matches = domNode.className.match(this.__self._buildModValRE(modName, elemName || elem)));

                return matches ? matches[2] || true : '';
            },

            /**
             * Retrieves a name/value list of modifiers
             * @private
             * @param {Array} [modNames] Names of modifiers
             * @param {Object} [elem] Element
             * @returns {Object} Hash of modifier values by names
             */
            _extractMods: function _extractMods(modNames, elem) {
                var res = {},
                    extractAll = !modNames.length,
                    countMatched = 0;

                ((elem || this.domElem)[0].className.match(this.__self._buildModValRE('(' + (extractAll ? NAME_PATTERN : modNames.join('|')) + ')', elem, 'g')) || []).forEach(function (className) {
                    var matches = className.match(EXTRACT_MODS_RE);
                    res[matches[1]] = matches[2] || true;
                    ++countMatched;
                });

                // empty modifier values are not reflected in classes; they must be filled with empty values
                countMatched < modNames.length && modNames.forEach(function (modName) {
                    modName in res || (res[modName] = '');
                });

                return res;
            },

            /**
             * Sets a modifier's CSS class for a block's DOM element or nested element
             * @private
             * @param {String} modName Modifier name
             * @param {String} modVal Modifier value
             * @param {String} oldModVal Old modifier value
             * @param {jQuery} [elem] Element
             * @param {String} [elemName] Element name
             */
            _onSetMod: function _onSetMod(modName, modVal, oldModVal, elem, elemName) {
                if (modName !== 'js' || modVal !== '') {
                    var _self = this.__self,
                        classPrefix = _self._buildModClassPrefix(modName, elemName),
                        classRE = _self._buildModValRE(modName, elemName),
                        needDel = modVal === '' || modVal === false;

                    (elem || this.domElem).each(function () {
                        var className = this.className,
                            modClassName = classPrefix;

                        modVal !== true && (modClassName += MOD_DELIM + modVal);

                        (oldModVal === true ? classRE.test(className) : (' ' + className).indexOf(' ' + classPrefix + MOD_DELIM) > -1) ? this.className = className.replace(classRE, needDel ? '' : '$1' + modClassName) : needDel || $(this).addClass(modClassName);
                    });

                    elemName && this.dropElemCache(elemName, modName, oldModVal).dropElemCache(elemName, modName, modVal);
                }

                this.__base.apply(this, arguments);
            },

            /**
             * Finds elements nested in a block
             * @param {jQuery} [ctx=this.domElem] Element where search is being performed
             * @param {String} names Nested element name (or names separated by spaces)
             * @param {String} [modName] Modifier name
             * @param {String} [modVal] Modifier value
             * @param {Boolean} [strictMode=false]
             * @returns {jQuery} DOM elements
             */
            findElem: function findElem(ctx, names, modName, modVal, strictMode) {
                if (typeof ctx === 'string') {
                    strictMode = modVal;
                    modVal = modName;
                    modName = names;
                    names = ctx;
                    ctx = this.domElem;
                }

                if (typeof modName === 'boolean') {
                    strictMode = modName;
                    modName = undef;
                }

                names = names.split(' ');

                var _self = this.__self,
                    modPostfix = buildModPostfix(modName, modVal),
                    selectors = [],
                    keys = names.map(function (name) {
                    selectors.push(_self.buildSelector(name, modName, modVal));
                    return name + modPostfix;
                }),
                    isSingleName = keys.length === 1,
                    res = findDomElem(ctx, selectors.join(','));

                // caching results if possible
                ctx === this.domElem && selectors.forEach(function (selector, i) {
                    (this._elemCache[keys[i]] = isSingleName ? res : res.filter(selector)).__bemElemName = names[i];
                }, this);

                return strictMode ? this._filterFindElemResults(res) : res;
            },

            /**
             * Filters results of findElem helper execution in strict mode
             * @param {jQuery} res DOM elements
             * @returns {jQuery} DOM elements
             */
            _filterFindElemResults: function _filterFindElemResults(res) {
                var blockSelector = this.buildSelector(),
                    domElem = this.domElem;
                return res.filter(function () {
                    return domElem.index($(this).closest(blockSelector)) > -1;
                });
            },

            /**
             * Finds elements nested in a block
             * @private
             * @param {String} name Nested element name
             * @param {String} [modName] Modifier name
             * @param {String|Boolean} [modVal] Modifier value
             * @returns {jQuery} DOM elements
             */
            _elem: function _elem(name, modName, modVal) {
                return this._elemCache[name + buildModPostfix(modName, modVal)] || this.findElem(name, modName, modVal);
            },

            /**
             * Lazy search for elements nested in a block (caches results)
             * @param {String} names Nested element name (or names separated by spaces)
             * @param {String} [modName] Modifier name
             * @param {String|Boolean} [modVal=true] Modifier value
             * @returns {jQuery} DOM elements
             */
            elem: function elem(names, modName, modVal) {
                if (arguments.length === 2) {
                    modVal = true;
                }

                if (modName && typeof modName !== 'string') {
                    modName.__bemElemName = names;
                    return modName;
                }

                if (names.indexOf(' ') < 0) {
                    return this._elem(names, modName, modVal);
                }

                var res = $([]);
                names.split(' ').forEach(function (name) {
                    res = res.add(this._elem(name, modName, modVal));
                }, this);
                return res;
            },

            /**
             * Finds elements outside the context
             * @param {jQuery} ctx context
             * @param {String} elemName Element name
             * @returns {jQuery} DOM elements
             */
            closestElem: function closestElem(ctx, elemName) {
                return ctx.closest(this.buildSelector(elemName));
            },

            /**
             * Clearing the cache for elements
             * @protected
             * @param {String} [names] Nested element name (or names separated by spaces)
             * @param {String} [modName] Modifier name
             * @param {String} [modVal] Modifier value
             * @returns {BEMDOM} this
             */
            dropElemCache: function dropElemCache(names, modName, modVal) {
                if (names) {
                    var modPostfix = buildModPostfix(modName, modVal);
                    names.indexOf(' ') < 0 ? delete this._elemCache[names + modPostfix] : names.split(' ').forEach(function (name) {
                        delete this._elemCache[name + modPostfix];
                    }, this);
                } else {
                    this._elemCache = {};
                }

                return this;
            },

            /**
             * Retrieves parameters of a block element
             * @param {String|jQuery} elem Element
             * @returns {Object} Parameters
             */
            elemParams: function elemParams(elem) {
                var elemName;
                if (typeof elem === 'string') {
                    elemName = elem;
                    elem = this.elem(elem);
                } else {
                    elemName = this.__self._extractElemNameFrom(elem);
                }

                return extractParams(elem[0])[this.__self.buildClass(elemName)] || {};
            },

            /**
             * Elemify given element
             * @param {jQuery} elem Element
             * @param {String} elemName Name
             * @returns {jQuery}
             */
            elemify: function elemify(elem, elemName) {
                (elem = $(elem)).__bemElemName = elemName;
                return elem;
            },

            /**
             * Checks whether a DOM element is in a block
             * @protected
             * @param {jQuery} [ctx=this.domElem] Element where check is being performed
             * @param {jQuery} domElem DOM element
             * @returns {Boolean}
             */
            containsDomElem: function containsDomElem(ctx, domElem) {
                if (arguments.length === 1) {
                    domElem = ctx;
                    ctx = this.domElem;
                }

                return dom.contains(ctx, domElem);
            },

            /**
             * Builds a CSS selector corresponding to a block/element and modifier
             * @param {String} [elem] Element name
             * @param {String} [modName] Modifier name
             * @param {String} [modVal] Modifier value
             * @returns {String}
             */
            buildSelector: function buildSelector(elem, modName, modVal) {
                return this.__self.buildSelector(elem, modName, modVal);
            },

            /**
             * Destructs a block
             * @private
             */
            _destruct: function _destruct() {
                var _this = this,
                    _self = _this.__self;

                _this._needSpecialUnbind && _self.doc.add(_self.win).unbind('.' + _this._uniqId);

                _this.__base();

                delete uniqIdToBlock[_this.un()._uniqId];
            }

        }, /** @lends BEMDOM */{

            /**
             * Scope
             * @type jQuery
             */
            scope: $('body'),

            /**
             * Document shortcut
             * @type jQuery
             */
            doc: doc,

            /**
             * Window shortcut
             * @type jQuery
             */
            win: win,

            /**
             * Processes a block's live properties
             * @private
             * @param {Boolean} [heedLive=false] Whether to take into account that the block already processed its live properties
             * @returns {Boolean} Whether the block is a live block
             */
            _processLive: function _processLive(heedLive) {
                var res = this._liveInitable;

                if ('live' in this) {
                    var noLive = typeof res === 'undefined';

                    if (noLive ^ heedLive) {
                        // should be opposite to each other
                        res = this.live() !== false;

                        var blockName = this.getName(),
                            origLive = this.live;

                        this.live = function () {
                            return this.getName() === blockName ? res : origLive.apply(this, arguments);
                        };
                    }
                }

                return res;
            },

            /**
             * Initializes blocks on a fragment of the DOM tree
             * @param {jQuery|String} [ctx=scope] Root DOM node
             * @returns {jQuery} ctx Initialization context
             */
            init: function init(ctx) {
                if (typeof ctx === 'string') {
                    ctx = $(ctx);
                } else if (!ctx) ctx = DOM.scope;

                var uniqInitId = identify();
                findDomElem(ctx, BEM_SELECTOR).each(function () {
                    initBlocks($(this), uniqInitId);
                });

                this._runInitFns();

                return ctx;
            },

            /**
             * @param {jQuery} ctx Root DOM node
             * @param {Boolean} [excludeSelf=false] Exclude the main domElem
             * @param {Boolean} [destructDom=false] Remove DOM node during destruction
             * @private
             */
            _destruct: function _destruct(ctx, excludeSelf, destructDom) {
                var _ctx;
                if (excludeSelf) {
                    storeDomNodeParents(_ctx = ctx.children());
                    destructDom && ctx.empty();
                } else {
                    storeDomNodeParents(_ctx = ctx);
                    destructDom && ctx.remove();
                }

                reverse.call(findDomElem(_ctx, BEM_SELECTOR)).each(function (_, domNode) {
                    var params = getParams(domNode);
                    objects.each(params, function (blockParams) {
                        if (blockParams.uniqId) {
                            var block = uniqIdToBlock[blockParams.uniqId];
                            block ? removeDomNodeFromBlock(block, domNode) : delete uniqIdToDomElems[blockParams.uniqId];
                        }
                    });
                    delete domElemToParams[identify(domNode)];
                });
            },

            /**
             * Destroys blocks on a fragment of the DOM tree
             * @param {jQuery} ctx Root DOM node
             * @param {Boolean} [excludeSelf=false] Exclude the main domElem
             */
            destruct: function destruct(ctx, excludeSelf) {
                this._destruct(ctx, excludeSelf, true);
            },

            /**
             * Detaches blocks on a fragment of the DOM tree without destructing DOM tree
             * @param {jQuery} ctx Root DOM node
             * @param {Boolean} [excludeSelf=false] Exclude the main domElem
             */
            detach: function detach(ctx, excludeSelf) {
                this._destruct(ctx, excludeSelf);
            },

            /**
             * Replaces a fragment of the DOM tree inside the context, destroying old blocks and intializing new ones
             * @param {jQuery} ctx Root DOM node
             * @param {jQuery|String} content New content
             * @returns {jQuery} Updated root DOM node
             */
            update: function update(ctx, content) {
                this.destruct(ctx, true);
                return this.init(ctx.html(content));
            },

            /**
             * Changes a fragment of the DOM tree including the context and initializes blocks.
             * @param {jQuery} ctx Root DOM node
             * @param {jQuery|String} content Content to be added
             * @returns {jQuery} New content
             */
            replace: function replace(ctx, content) {
                var prev = ctx.prev(),
                    parent = ctx.parent();

                content = getJqueryCollection(content);

                this.destruct(ctx);

                return this.init(prev.length ? content.insertAfter(prev) : content.prependTo(parent));
            },

            /**
             * Adds a fragment of the DOM tree at the end of the context and initializes blocks
             * @param {jQuery} ctx Root DOM node
             * @param {jQuery|String} content Content to be added
             * @returns {jQuery} New content
             */
            append: function append(ctx, content) {
                return this.init(getJqueryCollection(content).appendTo(ctx));
            },

            /**
             * Adds a fragment of the DOM tree at the beginning of the context and initializes blocks
             * @param {jQuery} ctx Root DOM node
             * @param {jQuery|String} content Content to be added
             * @returns {jQuery} New content
             */
            prepend: function prepend(ctx, content) {
                return this.init(getJqueryCollection(content).prependTo(ctx));
            },

            /**
             * Adds a fragment of the DOM tree before the context and initializes blocks
             * @param {jQuery} ctx Contextual DOM node
             * @param {jQuery|String} content Content to be added
             * @returns {jQuery} New content
             */
            before: function before(ctx, content) {
                return this.init(getJqueryCollection(content).insertBefore(ctx));
            },

            /**
             * Adds a fragment of the DOM tree after the context and initializes blocks
             * @param {jQuery} ctx Contextual DOM node
             * @param {jQuery|String} content Content to be added
             * @returns {jQuery} New content
             */
            after: function after(ctx, content) {
                return this.init(getJqueryCollection(content).insertAfter(ctx));
            },

            /**
             * Builds a full name for a live event
             * @private
             * @param {String} e Event name
             * @returns {String}
             */
            _buildCtxEventName: function _buildCtxEventName(e) {
                return this._name + ':' + e;
            },

            _liveClassBind: function _liveClassBind(className, e, callback, invokeOnInit) {
                if (e.indexOf(' ') > -1) {
                    e.split(' ').forEach(function (e) {
                        this._liveClassBind(className, e, callback, invokeOnInit);
                    }, this);
                } else {
                    var storage = liveClassEventStorage[e],
                        uniqId = identify(callback);

                    if (!storage) {
                        storage = liveClassEventStorage[e] = {};
                        DOM.scope.bind(e, $.proxy(this._liveClassTrigger, this));
                    }

                    storage = storage[className] || (storage[className] = { uniqIds: {}, fns: [] });

                    if (!(uniqId in storage.uniqIds)) {
                        storage.fns.push({ uniqId: uniqId, fn: this._buildLiveEventFn(callback, invokeOnInit) });
                        storage.uniqIds[uniqId] = storage.fns.length - 1;
                    }
                }

                return this;
            },

            _liveClassUnbind: function _liveClassUnbind(className, e, callback) {
                var storage = liveClassEventStorage[e];
                if (storage) {
                    if (callback) {
                        if (storage = storage[className]) {
                            var uniqId = identify(callback);
                            if (uniqId in storage.uniqIds) {
                                var i = storage.uniqIds[uniqId],
                                    len = storage.fns.length - 1;
                                storage.fns.splice(i, 1);
                                while (i < len) storage.uniqIds[storage.fns[i++].uniqId] = i - 1;
                                delete storage.uniqIds[uniqId];
                            }
                        }
                    } else {
                        delete storage[className];
                    }
                }

                return this;
            },

            _liveClassTrigger: function _liveClassTrigger(e) {
                var storage = liveClassEventStorage[e.type];
                if (storage) {
                    var node = e.target,
                        classNames = [];
                    for (var className in storage) {
                        classNames.push(className);
                    }
                    do {
                        var nodeClassName = ' ' + node.className + ' ',
                            i = 0;
                        while (className = classNames[i++]) {
                            if (nodeClassName.indexOf(' ' + className + ' ') > -1) {
                                var j = 0,
                                    fns = storage[className].fns,
                                    fn,
                                    stopPropagationAndPreventDefault = false;
                                while (fn = fns[j++]) if (fn.fn.call($(node), e) === false) stopPropagationAndPreventDefault = true;

                                stopPropagationAndPreventDefault && e.preventDefault();
                                if (stopPropagationAndPreventDefault || e.isPropagationStopped()) return;

                                classNames.splice(--i, 1);
                            }
                        }
                    } while (classNames.length && (node = node.parentNode));
                }
            },

            _buildLiveEventFn: function _buildLiveEventFn(callback, invokeOnInit) {
                var _this = this;
                return function (e) {
                    e.currentTarget = this;
                    var args = [_this._name, $(this).closest(_this.buildSelector()), undef, true],
                        block = initBlock.apply(null, invokeOnInit ? args.concat([callback, e]) : args);

                    if (block && !invokeOnInit && callback) return callback.apply(block, arguments);
                };
            },

            /**
             * Helper for live initialization for an event on DOM elements of a block or its elements
             * @protected
             * @param {String} [elemName] Element name or names (separated by spaces)
             * @param {String} event Event name
             * @param {Function} [callback] Handler to call after successful initialization
             */
            liveInitOnEvent: function liveInitOnEvent(elemName, event, callback) {
                return this.liveBindTo(elemName, event, callback, true);
            },

            /**
             * Helper for subscribing to live events on DOM elements of a block or its elements
             * @protected
             * @param {String|Object} [to] Description (object with modName, modVal, elem) or name of the element or elements (space-separated)
             * @param {String} event Event name
             * @param {Function} [callback] Handler
             */
            liveBindTo: function liveBindTo(to, event, callback, invokeOnInit) {
                if (!event || functions.isFunction(event)) {
                    callback = event;
                    event = to;
                    to = undef;
                }

                if (!to || typeof to === 'string') {
                    to = { elem: to };
                }

                if (to.elem && to.elem.indexOf(' ') > 0) {
                    to.elem.split(' ').forEach(function (elem) {
                        this._liveClassBind(this.buildClass(elem, to.modName, to.modVal), event, callback, invokeOnInit);
                    }, this);
                    return this;
                }

                return this._liveClassBind(this.buildClass(to.elem, to.modName, to.modVal), event, callback, invokeOnInit);
            },

            /**
             * Helper for unsubscribing from live events on DOM elements of a block or its elements
             * @protected
             * @param {String} [elem] Name of the element or elements (space-separated)
             * @param {String} event Event name
             * @param {Function} [callback] Handler
             */
            liveUnbindFrom: function liveUnbindFrom(elem, event, callback) {

                if (!event || functions.isFunction(event)) {
                    callback = event;
                    event = elem;
                    elem = undef;
                }

                if (elem && elem.indexOf(' ') > 1) {
                    elem.split(' ').forEach(function (elem) {
                        this._liveClassUnbind(this.buildClass(elem), event, callback);
                    }, this);
                    return this;
                }

                return this._liveClassUnbind(this.buildClass(elem), event, callback);
            },

            /**
             * Helper for live initialization when a different block is initialized
             * @private
             * @param {String} event Event name
             * @param {String} blockName Name of the block that should trigger a reaction when initialized
             * @param {Function} callback Handler to be called after successful initialization in the new block's context
             * @param {String} findFnName Name of the method for searching
             */
            _liveInitOnBlockEvent: function _liveInitOnBlockEvent(event, blockName, callback, findFnName) {
                var name = this._name;
                blocks[blockName].on(event, function (e) {
                    var args = arguments,
                        blocks = e.target[findFnName](name);

                    callback && blocks.forEach(function (block) {
                        callback.apply(block, args);
                    });
                });
                return this;
            },

            /**
             * Helper for live initialization for a different block's event on the current block's DOM element
             * @protected
             * @param {String} event Event name
             * @param {String} blockName Name of the block that should trigger a reaction when initialized
             * @param {Function} callback Handler to be called after successful initialization in the new block's context
             */
            liveInitOnBlockEvent: function liveInitOnBlockEvent(event, blockName, callback) {
                return this._liveInitOnBlockEvent(event, blockName, callback, 'findBlocksOn');
            },

            /**
             * Helper for live initialization for a different block's event inside the current block
             * @protected
             * @param {String} event Event name
             * @param {String} blockName Name of the block that should trigger a reaction when initialized
             * @param {Function} [callback] Handler to be called after successful initialization in the new block's context
             */
            liveInitOnBlockInsideEvent: function liveInitOnBlockInsideEvent(event, blockName, callback) {
                return this._liveInitOnBlockEvent(event, blockName, callback, 'findBlocksOutside');
            },

            /**
             * Adds a live event handler to a block, based on a specified element where the event will be listened for
             * @param {jQuery} [ctx] The element in which the event will be listened for
             * @param {String} e Event name
             * @param {Object} [data] Additional information that the handler gets as e.data
             * @param {Function} fn Handler
             * @param {Object} [fnCtx] Handler's context
             */
            on: function on(ctx, e, data, fn, fnCtx) {
                return typeof ctx === 'object' && ctx.jquery ? this._liveCtxBind(ctx, e, data, fn, fnCtx) : this.__base(ctx, e, data, fn);
            },

            /**
             * Removes the live event handler from a block, based on a specified element where the event was being listened for
             * @param {jQuery} [ctx] The element in which the event was being listened for
             * @param {String} e Event name
             * @param {Function} [fn] Handler
             * @param {Object} [fnCtx] Handler context
             */
            un: function un(ctx, e, fn, fnCtx) {
                return typeof ctx === 'object' && ctx.jquery ? this._liveCtxUnbind(ctx, e, fn, fnCtx) : this.__base(ctx, e, fn);
            },

            /**
             * Adds a live event handler to a block, based on a specified element where the event will be listened for
             * @private
             * @param {jQuery} ctx The element in which the event will be listened for
             * @param {String} e  Event name
             * @param {Object} [data] Additional information that the handler gets as e.data
             * @param {Function} fn Handler
             * @param {Object} [fnCtx] Handler context
             * @returns {BEMDOM} this
             */
            _liveCtxBind: function _liveCtxBind(ctx, e, data, fn, fnCtx) {
                if (typeof e === 'object') {
                    if (functions.isFunction(data) || functions.isFunction(fn)) {
                        // mod change event
                        e = this._buildModEventName(e);
                    } else {
                        objects.each(e, function (fn, e) {
                            this._liveCtxBind(ctx, e, fn, data);
                        }, this);
                        return this;
                    }
                }

                if (functions.isFunction(data)) {
                    fnCtx = fn;
                    fn = data;
                    data = undef;
                }

                if (e.indexOf(' ') > -1) {
                    e.split(' ').forEach(function (e) {
                        this._liveCtxBind(ctx, e, data, fn, fnCtx);
                    }, this);
                } else {
                    var ctxE = this._buildCtxEventName(e),
                        storage = liveEventCtxStorage[ctxE] || (liveEventCtxStorage[ctxE] = { counter: 0, ctxs: {} });

                    ctx.each(function () {
                        var ctxId = identify(this),
                            ctxStorage = storage.ctxs[ctxId];
                        if (!ctxStorage) {
                            ctxStorage = storage.ctxs[ctxId] = {};
                            ++storage.counter;
                        }
                        ctxStorage[identify(fn) + (fnCtx ? identify(fnCtx) : '')] = {
                            fn: fn,
                            data: data,
                            ctx: fnCtx
                        };
                    });
                }

                return this;
            },

            /**
             * Removes a live event handler from a block, based on a specified element where the event was being listened for
             * @private
             * @param {jQuery} ctx The element in which the event was being listened for
             * @param {String|Object} e Event name
             * @param {Function} [fn] Handler
             * @param {Object} [fnCtx] Handler context
             */
            _liveCtxUnbind: function _liveCtxUnbind(ctx, e, fn, fnCtx) {
                if (typeof e === 'object' && functions.isFunction(fn)) {
                    // mod change event
                    e = this._buildModEventName(e);
                }

                var storage = liveEventCtxStorage[e = this._buildCtxEventName(e)];

                if (storage) {
                    ctx.each(function () {
                        var ctxId = identify(this, true),
                            ctxStorage;
                        if (ctxId && (ctxStorage = storage.ctxs[ctxId])) {
                            fn && delete ctxStorage[identify(fn) + (fnCtx ? identify(fnCtx) : '')];
                            if (!fn || objects.isEmpty(ctxStorage)) {
                                storage.counter--;
                                delete storage.ctxs[ctxId];
                            }
                        }
                    });
                    storage.counter || delete liveEventCtxStorage[e];
                }

                return this;
            },

            /**
             * Retrieves the name of an element nested in a block
             * @private
             * @param {jQuery} elem Nested element
             * @returns {String|undef}
             */
            _extractElemNameFrom: function _extractElemNameFrom(elem) {
                if (elem.__bemElemName) return elem.__bemElemName;

                var matches = elem[0].className.match(this._buildElemNameRE());
                return matches ? matches[1] : undef;
            },

            /**
             * Builds a prefix for the CSS class of a DOM element or nested element of the block, based on modifier name
             * @private
             * @param {String} modName Modifier name
             * @param {jQuery|String} [elem] Element
             * @returns {String}
             */
            _buildModClassPrefix: function _buildModClassPrefix(modName, elem) {
                return this._name + (elem ? ELEM_DELIM + (typeof elem === 'string' ? elem : this._extractElemNameFrom(elem)) : '') + MOD_DELIM + modName;
            },

            /**
             * Builds a regular expression for extracting modifier values from a DOM element or nested element of a block
             * @private
             * @param {String} modName Modifier name
             * @param {jQuery|String} [elem] Element
             * @param {String} [quantifiers] Regular expression quantifiers
             * @returns {RegExp}
             */
            _buildModValRE: function _buildModValRE(modName, elem, quantifiers) {
                return new RegExp('(\\s|^)' + this._buildModClassPrefix(modName, elem) + '(?:' + MOD_DELIM + '(' + NAME_PATTERN + '))?(?=\\s|$)', quantifiers);
            },

            /**
             * Builds a regular expression for extracting names of elements nested in a block
             * @private
             * @returns {RegExp}
             */
            _buildElemNameRE: function _buildElemNameRE() {
                return new RegExp(this._name + ELEM_DELIM + '(' + NAME_PATTERN + ')(?:\\s|$)');
            },

            /**
             * Builds a CSS class corresponding to the block/element and modifier
             * @param {String} [elem] Element name
             * @param {String} [modName] Modifier name
             * @param {String} [modVal] Modifier value
             * @returns {String}
             */
            buildClass: function buildClass(elem, modName, modVal) {
                return _buildClass(this._name, elem, modName, modVal);
            },

            /**
             * Builds a CSS selector corresponding to the block/element and modifier
             * @param {String} [elem] Element name
             * @param {String} [modName] Modifier name
             * @param {String} [modVal] Modifier value
             * @returns {String}
             */
            buildSelector: function buildSelector(elem, modName, modVal) {
                return '.' + this.buildClass(elem, modName, modVal);
            }
        });

        /**
         * Returns a block on a DOM element and initializes it if necessary
         * @param {String} blockName Block name
         * @param {Object} params Block parameters
         * @returns {BEMDOM}
         */
        $.fn.bem = function (blockName, params) {
            return initBlock(blockName, this, params, true)._init();
        };

        provide(DOM);
    });
});

(function () {

    var origDefine = modules.define;

    modules.define = function (name, deps, decl) {
        origDefine.apply(modules, arguments);

        name !== 'i-bem__dom_init' && arguments.length > 2 && ~deps.indexOf('i-bem__dom') && modules.define('i-bem__dom_init', [name], function (provide, _, prev) {
            provide(prev);
        });
    };
})();
/**
 * @module jquery
 * @description Provide jQuery (load if it does not exist).
 */

'use strict';

modules.define('jquery', ['loader_type_js', 'jquery__config'], function (provide, loader, cfg) {

    /* global jQuery */

    function doProvide(preserveGlobal) {
        /**
         * @exports
         * @type Function
         */
        provide(preserveGlobal ? jQuery : jQuery.noConflict(true));
    }

    typeof jQuery !== 'undefined' ? doProvide(true) : loader(cfg.url, doProvide);
});
/**
 * @module jquery__config
 * @description Configuration for jQuery
 */

'use strict';

modules.define('jquery__config', function (provide) {

  provide( /** @exports */{
    /**
     * URL for loading jQuery if it does not exist
     * @type {String}
     */
    url: 'https://yastatic.net/jquery/2.1.4/jquery.min.js'
  });
});
/**
 * @module jquery__config
 * @description Configuration for jQuery
 */

'use strict';

modules.define('jquery__config', ['ua', 'objects'], function (provide, ua, objects, base) {

    provide(ua.msie && parseInt(ua.version, 10) < 9 ? objects.extend(base, {
        url: 'https://yastatic.net/jquery/1.11.3/jquery.min.js'
    }) : base);
});
/**
 * @module ua
 * @description Detect some user agent features (works like jQuery.browser in jQuery 1.8)
 * @see http://code.jquery.com/jquery-migrate-1.1.1.js
 */

'use strict';

modules.define('ua', function (provide) {

    var ua = navigator.userAgent.toLowerCase(),
        match = /(chrome)[ \/]([\w.]+)/.exec(ua) || /(webkit)[ \/]([\w.]+)/.exec(ua) || /(opera)(?:.*version|)[ \/]([\w.]+)/.exec(ua) || /(msie) ([\w.]+)/.exec(ua) || ua.indexOf('compatible') < 0 && /(mozilla)(?:.*? rv:([\w.]+)|)/.exec(ua) || [],
        matched = {
        browser: match[1] || '',
        version: match[2] || '0'
    },
        browser = {};

    if (matched.browser) {
        browser[matched.browser] = true;
        browser.version = matched.version;
    }

    if (browser.chrome) {
        browser.webkit = true;
    } else if (browser.webkit) {
        browser.safari = true;
    }

    /**
     * @exports
     * @type Object
     */
    provide(browser);
});
/**
 * @module dom
 * @description some DOM utils
 */

'use strict';

modules.define('dom', ['jquery'], function (provide, $) {

    provide( /** @exports */{
        /**
         * Checks whether a DOM elem is in a context
         * @param {jQuery} ctx DOM elem where check is being performed
         * @param {jQuery} domElem DOM elem to check
         * @returns {Boolean}
         */
        contains: function contains(ctx, domElem) {
            var res = false;

            domElem.each(function () {
                var domNode = this;
                do {
                    if (~ctx.index(domNode)) return !(res = true);
                } while (domNode = domNode.parentNode);

                return res;
            });

            return res;
        },

        /**
         * Returns current focused DOM elem in document
         * @returns {jQuery}
         */
        getFocused: function getFocused() {
            // "Error: Unspecified error." in iframe in IE9
            try {
                return $(document.activeElement);
            } catch (e) {}
        },

        /**
         * Checks whether a DOM element contains focus
         * @param {jQuery} domElem
         * @returns {Boolean}
         */
        containsFocus: function containsFocus(domElem) {
            return this.contains(domElem, this.getFocused());
        },

        /**
        * Checks whether a browser currently can set focus on DOM elem
        * @param {jQuery} domElem
        * @returns {Boolean}
        */
        isFocusable: function isFocusable(domElem) {
            var domNode = domElem[0];

            if (!domNode) return false;
            if (domNode.hasAttribute('tabindex')) return true;

            switch (domNode.tagName.toLowerCase()) {
                case 'iframe':
                    return true;

                case 'input':
                case 'button':
                case 'textarea':
                case 'select':
                    return !domNode.disabled;

                case 'a':
                    return !!domNode.href;
            }

            return false;
        },

        /**
        * Checks whether a domElem is intended to edit text
        * @param {jQuery} domElem
        * @returns {Boolean}
        */
        isEditable: function isEditable(domElem) {
            var domNode = domElem[0];

            if (!domNode) return false;

            switch (domNode.tagName.toLowerCase()) {
                case 'input':
                    var type = domNode.type;
                    return (type === 'text' || type === 'password') && !domNode.disabled && !domNode.readOnly;

                case 'textarea':
                    return !domNode.disabled && !domNode.readOnly;

                default:
                    return domNode.contentEditable === 'true';
            }
        }
    });
});
/**
 * @module i-bem__dom_init
 */

'use strict';

modules.define('i-bem__dom_init', ['i-bem__dom'], function (provide, BEMDOM) {

  provide(
  /**
   * Initializes blocks on a fragment of the DOM tree
   * @exports
   * @param {jQuery} [ctx=scope] Root DOM node
   * @returns {jQuery} ctx Initialization context
   */
  function (ctx) {
    return BEMDOM.init(ctx);
  });
});
/**
 * @module todo
 */
'use strict';

modules.define('todo', ['i-bem__dom', 'redux-state-container', 'checkbox', 'button', 'BEMHTML'], function (provide, BEMDOM, ReduxStateContainer, Checkbox, Button, BEMHTML) {

    /**
     * Reducer for todo actions
     * @param {Object} state Previous state
     * @param {Object} action Action
     * @param {String} action.type Type of action
     * @returns {Object} New state
     */
    var todosReducer = function todosReducer(state, action) {
        switch (action.type) {
            case 'ADD_TODO':
                return [{
                    id: state.reduce(function (maxId, todo) {
                        return Math.max(todo.id, maxId);
                    }, -1) + 1,
                    completed: false,
                    text: action.text
                }].concat(babelHelpers.toConsumableArray(state));

            case 'DELETE_TODO':
                return state.filter(function (todo) {
                    return todo.id !== action.id;
                });

            case 'COMPLETE_TODO':
                return state.map(function (todo) {
                    return todo.id === action.id ? Object.assign({}, todo, { completed: !todo.completed }) : todo;
                });

            case 'FILTER':
                var TODO_FILTERS = {
                    'show_all': function show_all() {
                        return true;
                    },
                    'show_active': function show_active(todo) {
                        return !todo.completed;
                    },
                    'show_completed': function show_completed(todo) {
                        return todo.completed;
                    }
                };
                return state.map(function (todo) {
                    return Object.assign({}, todo, { hidden: !TODO_FILTERS[action.filterType](todo) });
                });

            case 'CLEAR_COMPLETED':
                return state.filter(function (todo) {
                    return todo.completed === false;
                });

            default:
                return state;
        }
    };

    /**
     * @exports
     * @class todo
     * @abstract
     * @bem
     */
    provide(BEMDOM.decl({ block: this.name, baseBlock: ReduxStateContainer }, /** @lends todo.prototype */{
        onSetMod: {
            js: {
                inited: function inited() {
                    var _this = this;

                    this.__base.apply(this, arguments);

                    this.bAddTodoInput = this.findBlockInside('header', 'input');
                    this.bAddTodoInput.bindTo('control', 'keydown', function (e) {
                        var text = e.target.value.trim();
                        if (text.length && e.which === 13) {
                            _this.store.dispatch({ type: 'ADD_TODO', text: text });
                            _this.bAddTodoInput.setVal('');
                        }
                    });
                    this.bAddTodoInput.bindTo('control', 'blur', function (e) {
                        var text = e.target.value.trim();
                        if (text.length) {
                            _this.store.dispatch({ type: 'ADD_TODO', text: text });
                            _this.bAddTodoInput.setVal('');
                        }
                    });

                    Checkbox.on(this.elem('list'), { modName: 'checked', modVal: '*' }, function (e) {
                        var targetBlock = e.target;
                        var $item = targetBlock.domElem.closest('.todo__item');
                        var itemId = _this.elemParams($item).id;
                        _this.store.dispatch({ type: 'COMPLETE_TODO', id: itemId });
                    }, this);

                    Button.on(this.elem('list'), 'click', function (e) {
                        var targetBlock = e.target;
                        var $item = targetBlock.domElem.closest('.todo__item');
                        var itemId = _this.elemParams($item).id;
                        _this.store.dispatch({ type: 'DELETE_TODO', id: itemId });
                    }, this);

                    this.bFilterGroup = this.findBlockInside('footer', 'radio-group');
                    this.bFilterGroup.on('change', function (e) {
                        _this.store.dispatch({ type: 'FILTER', filterType: e.target.getVal() });
                    });

                    this.bClearButton = this.findBlockInside('clear-completed', 'button');
                    this.bClearButton.on('click', function () {
                        _this.store.dispatch({ type: 'CLEAR_COMPLETED' });
                    });

                    this.store.subscribe(function () {
                        var listContentBemjson = _this.store.getState().todos.map(function (todo) {
                            return {
                                block: 'todo',
                                elem: 'item',
                                elemMods: { hidden: todo.hidden },
                                js: { id: todo.id },
                                checked: todo.completed,
                                text: todo.text
                            };
                        });
                        var listContent = BEMHTML.apply(listContentBemjson);
                        BEMDOM.update(_this.elem('list'), listContent);
                    });
                }
            }
        },

        /**
         * Returns initial state
         * @override
         * @returns {Object}
         */
        getInitialState: function getInitialState() {
            return {
                todos: []
            };
        },

        /**
         * Root reducer
         * @override
         * @param {Object} state Previous state
         * @param {Object} action Action
         * @param {String} action.type Type of action
         * @returns {Object} New state
         */
        rootReducer: function rootReducer(state, action) {
            return {
                todos: todosReducer(state.todos, action)
            };
        }
    }));
});
/**
 * @module redux-state-container
 */
'use strict';

modules.define('redux-state-container', ['i-bem__dom', 'redux'], function (provide, BEMDOM, Redux) {

    /**
     * @exports
     * @class redux-state-container
     * @abstract
     * @bem
     */
    provide(BEMDOM.decl(this.name, /** @lends control.prototype */{
        onSetMod: {
            js: {
                inited: function inited() {
                    var initialState = this.getInitialState();
                    /**
                     * Store of Redux State Container
                     * @public
                     * @type {Object}
                     */
                    this.store = Redux.createStore(this.rootReducer, initialState);
                }
            }
        },

        /**
         * Returns initial state
         * Should be overridden
         * @returns {Object}
         */
        getInitialState: function getInitialState() {
            return {};
        },

        /**
         * Root reducer
         * Should be overridden
         * @param {Object} state Previous state
         * @param {Object} action Action
         * @param {String} action.type Type of action
         * @returns {Object} New state
         */
        rootReducer: function rootReducer(state, action) {
            return state;
        }
    }));
});
"use strict";

(function e(t, n, r) {
  function s(o, u) {
    if (!n[o]) {
      if (!t[o]) {
        var a = typeof require == "function" && require;if (!u && a) return a(o, !0);if (i) return i(o, !0);var f = new Error("Cannot find module '" + o + "'");throw (f.code = "MODULE_NOT_FOUND", f);
      }var l = n[o] = { exports: {} };t[o][0].call(l.exports, function (e) {
        var n = t[o][1][e];return s(n ? n : e);
      }, l, l.exports, e, t, n, r);
    }return n[o].exports;
  }var i = typeof require == "function" && require;for (var o = 0; o < r.length; o++) s(r[o]);return s;
})({ 1: [function (require, module, exports) {
    modules.define('redux', function (provide) {
      var redux = require('redux');
      provide(redux);
    });
  }, { "redux": 8 }], 2: [function (require, module, exports) {
    // shim for using process in browser

    var process = module.exports = {};
    var queue = [];
    var draining = false;
    var currentQueue;
    var queueIndex = -1;

    function cleanUpNextTick() {
      draining = false;
      if (currentQueue.length) {
        queue = currentQueue.concat(queue);
      } else {
        queueIndex = -1;
      }
      if (queue.length) {
        drainQueue();
      }
    }

    function drainQueue() {
      if (draining) {
        return;
      }
      var timeout = setTimeout(cleanUpNextTick);
      draining = true;

      var len = queue.length;
      while (len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
          if (currentQueue) {
            currentQueue[queueIndex].run();
          }
        }
        queueIndex = -1;
        len = queue.length;
      }
      currentQueue = null;
      draining = false;
      clearTimeout(timeout);
    }

    process.nextTick = function (fun) {
      var args = new Array(arguments.length - 1);
      if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
          args[i - 1] = arguments[i];
        }
      }
      queue.push(new Item(fun, args));
      if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
      }
    };

    // v8 likes predictible objects
    function Item(fun, array) {
      this.fun = fun;
      this.array = array;
    }
    Item.prototype.run = function () {
      this.fun.apply(null, this.array);
    };
    process.title = 'browser';
    process.browser = true;
    process.env = {};
    process.argv = [];
    process.version = ''; // empty string to avoid regexp issues
    process.versions = {};

    function noop() {}

    process.on = noop;
    process.addListener = noop;
    process.once = noop;
    process.off = noop;
    process.removeListener = noop;
    process.removeAllListeners = noop;
    process.emit = noop;

    process.binding = function (name) {
      throw new Error('process.binding is not supported');
    };

    process.cwd = function () {
      return '/';
    };
    process.chdir = function (dir) {
      throw new Error('process.chdir is not supported');
    };
    process.umask = function () {
      return 0;
    };
  }, {}], 3: [function (require, module, exports) {
    'use strict';

    var _extends = Object.assign || function (target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i];for (var key in source) {
          if (Object.prototype.hasOwnProperty.call(source, key)) {
            target[key] = source[key];
          }
        }
      }return target;
    };

    exports.__esModule = true;
    exports["default"] = applyMiddleware;

    var _compose = require('./compose');

    var _compose2 = _interopRequireDefault(_compose);

    function _interopRequireDefault(obj) {
      return obj && obj.__esModule ? obj : { "default": obj };
    }

    /**
     * Creates a store enhancer that applies middleware to the dispatch method
     * of the Redux store. This is handy for a variety of tasks, such as expressing
     * asynchronous actions in a concise manner, or logging every action payload.
     *
     * See `redux-thunk` package as an example of the Redux middleware.
     *
     * Because middleware is potentially asynchronous, this should be the first
     * store enhancer in the composition chain.
     *
     * Note that each middleware will be given the `dispatch` and `getState` functions
     * as named arguments.
     *
     * @param {...Function} middlewares The middleware chain to be applied.
     * @returns {Function} A store enhancer applying the middleware.
     */
    function applyMiddleware() {
      for (var _len = arguments.length, middlewares = Array(_len), _key = 0; _key < _len; _key++) {
        middlewares[_key] = arguments[_key];
      }

      return function (createStore) {
        return function (reducer, initialState, enhancer) {
          var store = createStore(reducer, initialState, enhancer);
          var _dispatch = store.dispatch;
          var chain = [];

          var middlewareAPI = {
            getState: store.getState,
            dispatch: function dispatch(action) {
              return _dispatch(action);
            }
          };
          chain = middlewares.map(function (middleware) {
            return middleware(middlewareAPI);
          });
          _dispatch = _compose2["default"].apply(undefined, chain)(store.dispatch);

          return _extends({}, store, {
            dispatch: _dispatch
          });
        };
      };
    }
  }, { "./compose": 6 }], 4: [function (require, module, exports) {
    'use strict';

    exports.__esModule = true;
    exports["default"] = bindActionCreators;
    function bindActionCreator(actionCreator, dispatch) {
      return function () {
        return dispatch(actionCreator.apply(undefined, arguments));
      };
    }

    /**
     * Turns an object whose values are action creators, into an object with the
     * same keys, but with every function wrapped into a `dispatch` call so they
     * may be invoked directly. This is just a convenience method, as you can call
     * `store.dispatch(MyActionCreators.doSomething())` yourself just fine.
     *
     * For convenience, you can also pass a single function as the first argument,
     * and get a function in return.
     *
     * @param {Function|Object} actionCreators An object whose values are action
     * creator functions. One handy way to obtain it is to use ES6 `import * as`
     * syntax. You may also pass a single function.
     *
     * @param {Function} dispatch The `dispatch` function available on your Redux
     * store.
     *
     * @returns {Function|Object} The object mimicking the original object, but with
     * every action creator wrapped into the `dispatch` call. If you passed a
     * function as `actionCreators`, the return value will also be a single
     * function.
     */
    function bindActionCreators(actionCreators, dispatch) {
      if (typeof actionCreators === 'function') {
        return bindActionCreator(actionCreators, dispatch);
      }

      if (typeof actionCreators !== 'object' || actionCreators === null) {
        throw new Error('bindActionCreators expected an object or a function, instead received ' + (actionCreators === null ? 'null' : typeof actionCreators) + '. ' + 'Did you write "import ActionCreators from" instead of "import * as ActionCreators from"?');
      }

      var keys = Object.keys(actionCreators);
      var boundActionCreators = {};
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var actionCreator = actionCreators[key];
        if (typeof actionCreator === 'function') {
          boundActionCreators[key] = bindActionCreator(actionCreator, dispatch);
        }
      }
      return boundActionCreators;
    }
  }, {}], 5: [function (require, module, exports) {
    (function (process) {
      'use strict';

      exports.__esModule = true;
      exports["default"] = combineReducers;

      var _createStore = require('./createStore');

      var _isPlainObject = require('lodash/isPlainObject');

      var _isPlainObject2 = _interopRequireDefault(_isPlainObject);

      var _warning = require('./utils/warning');

      var _warning2 = _interopRequireDefault(_warning);

      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : { "default": obj };
      }

      function getUndefinedStateErrorMessage(key, action) {
        var actionType = action && action.type;
        var actionName = actionType && '"' + actionType.toString() + '"' || 'an action';

        return 'Reducer "' + key + '" returned undefined handling ' + actionName + '. ' + 'To ignore an action, you must explicitly return the previous state.';
      }

      function getUnexpectedStateShapeWarningMessage(inputState, reducers, action) {
        var reducerKeys = Object.keys(reducers);
        var argumentName = action && action.type === _createStore.ActionTypes.INIT ? 'initialState argument passed to createStore' : 'previous state received by the reducer';

        if (reducerKeys.length === 0) {
          return 'Store does not have a valid reducer. Make sure the argument passed ' + 'to combineReducers is an object whose values are reducers.';
        }

        if (!(0, _isPlainObject2["default"])(inputState)) {
          return 'The ' + argumentName + ' has unexpected type of "' + ({}).toString.call(inputState).match(/\s([a-z|A-Z]+)/)[1] + '". Expected argument to be an object with the following ' + ('keys: "' + reducerKeys.join('", "') + '"');
        }

        var unexpectedKeys = Object.keys(inputState).filter(function (key) {
          return !reducers.hasOwnProperty(key);
        });

        if (unexpectedKeys.length > 0) {
          return 'Unexpected ' + (unexpectedKeys.length > 1 ? 'keys' : 'key') + ' ' + ('"' + unexpectedKeys.join('", "') + '" found in ' + argumentName + '. ') + 'Expected to find one of the known reducer keys instead: ' + ('"' + reducerKeys.join('", "') + '". Unexpected keys will be ignored.');
        }
      }

      function assertReducerSanity(reducers) {
        Object.keys(reducers).forEach(function (key) {
          var reducer = reducers[key];
          var initialState = reducer(undefined, { type: _createStore.ActionTypes.INIT });

          if (typeof initialState === 'undefined') {
            throw new Error('Reducer "' + key + '" returned undefined during initialization. ' + 'If the state passed to the reducer is undefined, you must ' + 'explicitly return the initial state. The initial state may ' + 'not be undefined.');
          }

          var type = '@@redux/PROBE_UNKNOWN_ACTION_' + Math.random().toString(36).substring(7).split('').join('.');
          if (typeof reducer(undefined, { type: type }) === 'undefined') {
            throw new Error('Reducer "' + key + '" returned undefined when probed with a random type. ' + ('Don\'t try to handle ' + _createStore.ActionTypes.INIT + ' or other actions in "redux/*" ') + 'namespace. They are considered private. Instead, you must return the ' + 'current state for any unknown actions, unless it is undefined, ' + 'in which case you must return the initial state, regardless of the ' + 'action type. The initial state may not be undefined.');
          }
        });
      }

      /**
       * Turns an object whose values are different reducer functions, into a single
       * reducer function. It will call every child reducer, and gather their results
       * into a single state object, whose keys correspond to the keys of the passed
       * reducer functions.
       *
       * @param {Object} reducers An object whose values correspond to different
       * reducer functions that need to be combined into one. One handy way to obtain
       * it is to use ES6 `import * as reducers` syntax. The reducers may never return
       * undefined for any action. Instead, they should return their initial state
       * if the state passed to them was undefined, and the current state for any
       * unrecognized action.
       *
       * @returns {Function} A reducer function that invokes every reducer inside the
       * passed object, and builds a state object with the same shape.
       */
      function combineReducers(reducers) {
        var reducerKeys = Object.keys(reducers);
        var finalReducers = {};
        for (var i = 0; i < reducerKeys.length; i++) {
          var key = reducerKeys[i];
          if (typeof reducers[key] === 'function') {
            finalReducers[key] = reducers[key];
          }
        }
        var finalReducerKeys = Object.keys(finalReducers);

        var sanityError;
        try {
          assertReducerSanity(finalReducers);
        } catch (e) {
          sanityError = e;
        }

        return function combination() {
          var state = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];
          var action = arguments[1];

          if (sanityError) {
            throw sanityError;
          }

          if (process.env.NODE_ENV !== 'production') {
            var warningMessage = getUnexpectedStateShapeWarningMessage(state, finalReducers, action);
            if (warningMessage) {
              (0, _warning2["default"])(warningMessage);
            }
          }

          var hasChanged = false;
          var nextState = {};
          for (var i = 0; i < finalReducerKeys.length; i++) {
            var key = finalReducerKeys[i];
            var reducer = finalReducers[key];
            var previousStateForKey = state[key];
            var nextStateForKey = reducer(previousStateForKey, action);
            if (typeof nextStateForKey === 'undefined') {
              var errorMessage = getUndefinedStateErrorMessage(key, action);
              throw new Error(errorMessage);
            }
            nextState[key] = nextStateForKey;
            hasChanged = hasChanged || nextStateForKey !== previousStateForKey;
          }
          return hasChanged ? nextState : state;
        };
      }
    }).call(this, require('_process'));
  }, { "./createStore": 7, "./utils/warning": 9, "_process": 2, "lodash/isPlainObject": 12 }], 6: [function (require, module, exports) {
    "use strict";

    exports.__esModule = true;
    exports["default"] = compose;
    /**
     * Composes single-argument functions from right to left.
     *
     * @param {...Function} funcs The functions to compose.
     * @returns {Function} A function obtained by composing functions from right to
     * left. For example, compose(f, g, h) is identical to arg => f(g(h(arg))).
     */
    function compose() {
      for (var _len = arguments.length, funcs = Array(_len), _key = 0; _key < _len; _key++) {
        funcs[_key] = arguments[_key];
      }

      return function () {
        if (funcs.length === 0) {
          return arguments.length <= 0 ? undefined : arguments[0];
        }

        var last = funcs[funcs.length - 1];
        var rest = funcs.slice(0, -1);

        return rest.reduceRight(function (composed, f) {
          return f(composed);
        }, last.apply(undefined, arguments));
      };
    }
  }, {}], 7: [function (require, module, exports) {
    'use strict';

    exports.__esModule = true;
    exports.ActionTypes = undefined;
    exports["default"] = createStore;

    var _isPlainObject = require('lodash/isPlainObject');

    var _isPlainObject2 = _interopRequireDefault(_isPlainObject);

    function _interopRequireDefault(obj) {
      return obj && obj.__esModule ? obj : { "default": obj };
    }

    /**
     * These are private action types reserved by Redux.
     * For any unknown actions, you must return the current state.
     * If the current state is undefined, you must return the initial state.
     * Do not reference these action types directly in your code.
     */
    var ActionTypes = exports.ActionTypes = {
      INIT: '@@redux/INIT'
    };

    /**
     * Creates a Redux store that holds the state tree.
     * The only way to change the data in the store is to call `dispatch()` on it.
     *
     * There should only be a single store in your app. To specify how different
     * parts of the state tree respond to actions, you may combine several reducers
     * into a single reducer function by using `combineReducers`.
     *
     * @param {Function} reducer A function that returns the next state tree, given
     * the current state tree and the action to handle.
     *
     * @param {any} [initialState] The initial state. You may optionally specify it
     * to hydrate the state from the server in universal apps, or to restore a
     * previously serialized user session.
     * If you use `combineReducers` to produce the root reducer function, this must be
     * an object with the same shape as `combineReducers` keys.
     *
     * @param {Function} enhancer The store enhancer. You may optionally specify it
     * to enhance the store with third-party capabilities such as middleware,
     * time travel, persistence, etc. The only store enhancer that ships with Redux
     * is `applyMiddleware()`.
     *
     * @returns {Store} A Redux store that lets you read the state, dispatch actions
     * and subscribe to changes.
     */
    function createStore(reducer, initialState, enhancer) {
      if (typeof initialState === 'function' && typeof enhancer === 'undefined') {
        enhancer = initialState;
        initialState = undefined;
      }

      if (typeof enhancer !== 'undefined') {
        if (typeof enhancer !== 'function') {
          throw new Error('Expected the enhancer to be a function.');
        }

        return enhancer(createStore)(reducer, initialState);
      }

      if (typeof reducer !== 'function') {
        throw new Error('Expected the reducer to be a function.');
      }

      var currentReducer = reducer;
      var currentState = initialState;
      var currentListeners = [];
      var nextListeners = currentListeners;
      var isDispatching = false;

      function ensureCanMutateNextListeners() {
        if (nextListeners === currentListeners) {
          nextListeners = currentListeners.slice();
        }
      }

      /**
       * Reads the state tree managed by the store.
       *
       * @returns {any} The current state tree of your application.
       */
      function getState() {
        return currentState;
      }

      /**
       * Adds a change listener. It will be called any time an action is dispatched,
       * and some part of the state tree may potentially have changed. You may then
       * call `getState()` to read the current state tree inside the callback.
       *
       * You may call `dispatch()` from a change listener, with the following
       * caveats:
       *
       * 1. The subscriptions are snapshotted just before every `dispatch()` call.
       * If you subscribe or unsubscribe while the listeners are being invoked, this
       * will not have any effect on the `dispatch()` that is currently in progress.
       * However, the next `dispatch()` call, whether nested or not, will use a more
       * recent snapshot of the subscription list.
       *
       * 2. The listener should not expect to see all states changes, as the state
       * might have been updated multiple times during a nested `dispatch()` before
       * the listener is called. It is, however, guaranteed that all subscribers
       * registered before the `dispatch()` started will be called with the latest
       * state by the time it exits.
       *
       * @param {Function} listener A callback to be invoked on every dispatch.
       * @returns {Function} A function to remove this change listener.
       */
      function subscribe(listener) {
        if (typeof listener !== 'function') {
          throw new Error('Expected listener to be a function.');
        }

        var isSubscribed = true;

        ensureCanMutateNextListeners();
        nextListeners.push(listener);

        return function unsubscribe() {
          if (!isSubscribed) {
            return;
          }

          isSubscribed = false;

          ensureCanMutateNextListeners();
          var index = nextListeners.indexOf(listener);
          nextListeners.splice(index, 1);
        };
      }

      /**
       * Dispatches an action. It is the only way to trigger a state change.
       *
       * The `reducer` function, used to create the store, will be called with the
       * current state tree and the given `action`. Its return value will
       * be considered the **next** state of the tree, and the change listeners
       * will be notified.
       *
       * The base implementation only supports plain object actions. If you want to
       * dispatch a Promise, an Observable, a thunk, or something else, you need to
       * wrap your store creating function into the corresponding middleware. For
       * example, see the documentation for the `redux-thunk` package. Even the
       * middleware will eventually dispatch plain object actions using this method.
       *
       * @param {Object} action A plain object representing “what changed”. It is
       * a good idea to keep actions serializable so you can record and replay user
       * sessions, or use the time travelling `redux-devtools`. An action must have
       * a `type` property which may not be `undefined`. It is a good idea to use
       * string constants for action types.
       *
       * @returns {Object} For convenience, the same action object you dispatched.
       *
       * Note that, if you use a custom middleware, it may wrap `dispatch()` to
       * return something else (for example, a Promise you can await).
       */
      function dispatch(action) {
        if (!(0, _isPlainObject2["default"])(action)) {
          throw new Error('Actions must be plain objects. ' + 'Use custom middleware for async actions.');
        }

        if (typeof action.type === 'undefined') {
          throw new Error('Actions may not have an undefined "type" property. ' + 'Have you misspelled a constant?');
        }

        if (isDispatching) {
          throw new Error('Reducers may not dispatch actions.');
        }

        try {
          isDispatching = true;
          currentState = currentReducer(currentState, action);
        } finally {
          isDispatching = false;
        }

        var listeners = currentListeners = nextListeners;
        for (var i = 0; i < listeners.length; i++) {
          listeners[i]();
        }

        return action;
      }

      /**
       * Replaces the reducer currently used by the store to calculate the state.
       *
       * You might need this if your app implements code splitting and you want to
       * load some of the reducers dynamically. You might also need this if you
       * implement a hot reloading mechanism for Redux.
       *
       * @param {Function} nextReducer The reducer for the store to use instead.
       * @returns {void}
       */
      function replaceReducer(nextReducer) {
        if (typeof nextReducer !== 'function') {
          throw new Error('Expected the nextReducer to be a function.');
        }

        currentReducer = nextReducer;
        dispatch({ type: ActionTypes.INIT });
      }

      // When a store is created, an "INIT" action is dispatched so that every
      // reducer returns their initial state. This effectively populates
      // the initial state tree.
      dispatch({ type: ActionTypes.INIT });

      return {
        dispatch: dispatch,
        subscribe: subscribe,
        getState: getState,
        replaceReducer: replaceReducer
      };
    }
  }, { "lodash/isPlainObject": 12 }], 8: [function (require, module, exports) {
    (function (process) {
      'use strict';

      exports.__esModule = true;
      exports.compose = exports.applyMiddleware = exports.bindActionCreators = exports.combineReducers = exports.createStore = undefined;

      var _createStore = require('./createStore');

      var _createStore2 = _interopRequireDefault(_createStore);

      var _combineReducers = require('./combineReducers');

      var _combineReducers2 = _interopRequireDefault(_combineReducers);

      var _bindActionCreators = require('./bindActionCreators');

      var _bindActionCreators2 = _interopRequireDefault(_bindActionCreators);

      var _applyMiddleware = require('./applyMiddleware');

      var _applyMiddleware2 = _interopRequireDefault(_applyMiddleware);

      var _compose = require('./compose');

      var _compose2 = _interopRequireDefault(_compose);

      var _warning = require('./utils/warning');

      var _warning2 = _interopRequireDefault(_warning);

      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : { "default": obj };
      }

      /*
      * This is a dummy function to check if the function name has been altered by minification.
      * If the function has been minified and NODE_ENV !== 'production', warn the user.
      */
      function isCrushed() {}

      if (process.env.NODE_ENV !== 'production' && typeof isCrushed.name === 'string' && isCrushed.name !== 'isCrushed') {
        (0, _warning2["default"])('You are currently using minified code outside of NODE_ENV === \'production\'. ' + 'This means that you are running a slower development build of Redux. ' + 'You can use loose-envify (https://github.com/zertosh/loose-envify) for browserify ' + 'or DefinePlugin for webpack (http://stackoverflow.com/questions/30030031) ' + 'to ensure you have the correct code for your production build.');
      }

      exports.createStore = _createStore2["default"];
      exports.combineReducers = _combineReducers2["default"];
      exports.bindActionCreators = _bindActionCreators2["default"];
      exports.applyMiddleware = _applyMiddleware2["default"];
      exports.compose = _compose2["default"];
    }).call(this, require('_process'));
  }, { "./applyMiddleware": 3, "./bindActionCreators": 4, "./combineReducers": 5, "./compose": 6, "./createStore": 7, "./utils/warning": 9, "_process": 2 }], 9: [function (require, module, exports) {
    'use strict';

    exports.__esModule = true;
    exports["default"] = warning;
    /**
     * Prints a warning in the console if it exists.
     *
     * @param {String} message The warning message.
     * @returns {void}
     */
    function warning(message) {
      /* eslint-disable no-console */
      if (typeof console !== 'undefined' && typeof console.error === 'function') {
        console.error(message);
      }
      /* eslint-enable no-console */
      try {
        // This error was thrown as a convenience so that you can use this stack
        // to find the callsite that caused this warning to fire.
        throw new Error(message);
        /* eslint-disable no-empty */
      } catch (e) {}
      /* eslint-enable no-empty */
    }
  }, {}], 10: [function (require, module, exports) {
    /**
     * Checks if `value` is a host object in IE < 9.
     *
     * @private
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a host object, else `false`.
     */
    function isHostObject(value) {
      // Many host objects are `Object` objects that can coerce to strings
      // despite having improperly defined `toString` methods.
      var result = false;
      if (value != null && typeof value.toString != 'function') {
        try {
          result = !!(value + '');
        } catch (e) {}
      }
      return result;
    }

    module.exports = isHostObject;
  }, {}], 11: [function (require, module, exports) {
    /**
     * Checks if `value` is object-like. A value is object-like if it's not `null`
     * and has a `typeof` result of "object".
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
     * @example
     *
     * _.isObjectLike({});
     * // => true
     *
     * _.isObjectLike([1, 2, 3]);
     * // => true
     *
     * _.isObjectLike(_.noop);
     * // => false
     *
     * _.isObjectLike(null);
     * // => false
     */
    function isObjectLike(value) {
      return !!value && typeof value == 'object';
    }

    module.exports = isObjectLike;
  }, {}], 12: [function (require, module, exports) {
    var isHostObject = require('./_isHostObject'),
        isObjectLike = require('./isObjectLike');

    /** `Object#toString` result references. */
    var objectTag = '[object Object]';

    /** Used for built-in method references. */
    var objectProto = Object.prototype;

    /** Used to resolve the decompiled source of functions. */
    var funcToString = Function.prototype.toString;

    /** Used to infer the `Object` constructor. */
    var objectCtorString = funcToString.call(Object);

    /**
     * Used to resolve the [`toStringTag`](http://ecma-international.org/ecma-262/6.0/#sec-object.prototype.tostring)
     * of values.
     */
    var objectToString = objectProto.toString;

    /** Built-in value references. */
    var getPrototypeOf = Object.getPrototypeOf;

    /**
     * Checks if `value` is a plain object, that is, an object created by the
     * `Object` constructor or one with a `[[Prototype]]` of `null`.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a plain object, else `false`.
     * @example
     *
     * function Foo() {
     *   this.a = 1;
     * }
     *
     * _.isPlainObject(new Foo);
     * // => false
     *
     * _.isPlainObject([1, 2, 3]);
     * // => false
     *
     * _.isPlainObject({ 'x': 0, 'y': 0 });
     * // => true
     *
     * _.isPlainObject(Object.create(null));
     * // => true
     */
    function isPlainObject(value) {
      if (!isObjectLike(value) || objectToString.call(value) != objectTag || isHostObject(value)) {
        return false;
      }
      var proto = getPrototypeOf(value);
      if (proto === null) {
        return true;
      }
      var Ctor = proto.constructor;
      return typeof Ctor == 'function' && Ctor instanceof Ctor && funcToString.call(Ctor) == objectCtorString;
    }

    module.exports = isPlainObject;
  }, { "./_isHostObject": 10, "./isObjectLike": 11 }] }, {}, [1]);
/**
 * @module input
 */

'use strict';

modules.define('input', ['i-bem__dom', 'control'], function (provide, BEMDOM, Control) {

    /**
     * @exports
     * @class input
     * @augments control
     * @bem
     */
    provide(BEMDOM.decl({ block: this.name, baseBlock: Control }, /** @lends input.prototype */{
        onSetMod: {
            'js': {
                'inited': function inited() {
                    this.__base.apply(this, arguments);
                    this._val = this.elem('control').val();
                }
            }
        },

        /**
         * Returns control value
         * @returns {String}
         * @override
         */
        getVal: function getVal() {
            return this._val;
        },

        /**
         * Sets control value
         * @param {String} val value
         * @param {Object} [data] additional data
         * @returns {input} this
         */
        setVal: function setVal(val, data) {
            val = String(val);

            if (this._val !== val) {
                this._val = val;

                var control = this.elem('control');
                control.val() !== val && control.val(val);

                this.emit('change', data);
            }

            return this;
        }
    }, /** @lends input */{
        live: function live() {
            this.__base.apply(this, arguments);
            return false;
        }
    }));
});
/**
 * @module input
 */

'use strict';

modules.define('input', ['tick', 'idle'], function (provide, tick, idle, Input) {

    var instances = [],
        boundToTick,
        bindToTick = function bindToTick() {
        boundToTick = true;
        tick.on('tick', update).start();
        idle.on({
            idle: function idle() {
                tick.un('tick', update);
            },
            wakeup: function wakeup() {
                tick.on('tick', update);
            }
        }).start();
    },
        update = function update() {
        var instance,
            i = 0;
        while (instance = instances[i++]) {
            instance.setVal(instance.elem('control').val());
        }
    };

    /**
     * @exports
     * @class input
     * @bem
     */
    provide(Input.decl( /** @lends input.prototype */{
        onSetMod: {
            'js': {
                'inited': function inited() {
                    this.__base.apply(this, arguments);

                    boundToTick || bindToTick();

                    // сохраняем индекс в массиве инстансов чтобы потом быстро из него удалять
                    this._instanceIndex = instances.push(this) - 1;
                },

                '': function _() {
                    this.__base.apply(this, arguments);

                    // удаляем из общего массива instances
                    instances.splice(this._instanceIndex, 1);
                    // понижаем _instanceIndex всем тем кто был добавлен в instances после нас
                    var i = this._instanceIndex,
                        instance;
                    while (instance = instances[i++]) --instance._instanceIndex;
                }
            }
        },

        /**
         * Нормализация установки фокуса для IE
         * @private
         * @override
         */
        _focus: function _focus() {
            var input = this.elem('control')[0];
            if (input.createTextRange && !input.selectionStart) {
                var range = input.createTextRange();
                range.move('character', input.value.length);
                range.select();
            } else {
                input.focus();
            }
        }
    }));
});
/**
 * @module control
 */

'use strict';

modules.define('control', ['i-bem__dom', 'dom', 'next-tick'], function (provide, BEMDOM, dom, nextTick) {

    /**
     * @exports
     * @class control
     * @abstract
     * @bem
     */
    provide(BEMDOM.decl(this.name, /** @lends control.prototype */{
        beforeSetMod: {
            'focused': {
                'true': function _true() {
                    return !this.hasMod('disabled');
                }
            }
        },

        onSetMod: {
            'js': {
                'inited': function inited() {
                    this._focused = dom.containsFocus(this.elem('control'));
                    this._focused ?
                    // if control is already in focus, we need to force _onFocus
                    this._onFocus() :
                    // if block already has focused mod, we need to focus control
                    this.hasMod('focused') && this._focus();

                    this._tabIndex = this.elem('control').attr('tabindex');
                    if (this.hasMod('disabled') && this._tabIndex !== 'undefined') this.elem('control').removeAttr('tabindex');
                }
            },

            'focused': {
                'true': function _true() {
                    this._focused || this._focus();
                },

                '': function _() {
                    this._focused && this._blur();
                }
            },

            'disabled': {
                'true': function _true() {
                    this.elem('control').attr('disabled', true);
                    this.delMod('focused');
                    typeof this._tabIndex !== 'undefined' && this.elem('control').removeAttr('tabindex');
                },

                '': function _() {
                    this.elem('control').removeAttr('disabled');
                    typeof this._tabIndex !== 'undefined' && this.elem('control').attr('tabindex', this._tabIndex);
                }
            }
        },

        /**
         * Returns name of control
         * @returns {String}
         */
        getName: function getName() {
            return this.elem('control').attr('name') || '';
        },

        /**
         * Returns control value
         * @returns {String}
         */
        getVal: function getVal() {
            return this.elem('control').val();
        },

        _onFocus: function _onFocus() {
            this._focused = true;
            this.setMod('focused');
        },

        _onBlur: function _onBlur() {
            this._focused = false;
            this.delMod('focused');
        },

        _focus: function _focus() {
            dom.isFocusable(this.elem('control')) ? this.elem('control').focus() : this._onFocus(); // issues/1456
        },

        _blur: function _blur() {
            dom.isFocusable(this.elem('control')) ? this.elem('control').blur() : this._onBlur();
        }
    }, /** @lends control */{
        live: function live() {
            this.liveBindTo('control', 'focusin', function () {
                this._focused || this._onFocus(); // to prevent double call of _onFocus in case of init by focus
            }).liveBindTo('control', 'focusout', this.prototype._onBlur);

            var focused = dom.getFocused();
            if (focused.hasClass(this.buildClass('control'))) {
                var _this = this; // TODO: https://github.com/bem/bem-core/issues/425
                nextTick(function () {
                    if (focused[0] === dom.getFocused()[0]) {
                        var block = focused.closest(_this.buildSelector());
                        block && block.bem(_this.getName());
                    }
                });
            }
        }
    }));
});
/** @module control */

'use strict';

modules.define('control', function (provide, Control) {

    provide(Control.decl({
        beforeSetMod: {
            'hovered': {
                'true': function _true() {
                    return !this.hasMod('disabled');
                }
            }
        },

        onSetMod: {
            'disabled': {
                'true': function _true() {
                    this.__base.apply(this, arguments);
                    this.delMod('hovered');
                }
            },

            'hovered': {
                'true': function _true() {
                    this.bindTo('mouseleave', this._onMouseLeave);
                },

                '': function _() {
                    this.unbindFrom('mouseleave', this._onMouseLeave);
                }
            }
        },

        _onMouseOver: function _onMouseOver() {
            this.setMod('hovered');
        },

        _onMouseLeave: function _onMouseLeave() {
            this.delMod('hovered');
        }
    }, {
        live: function live() {
            return this.liveBindTo('mouseover', this.prototype._onMouseOver).__base.apply(this, arguments);
        }
    }));
});
/**
 * FastClick to jQuery module wrapper.
 * @see https://github.com/ftlabs/fastclick
 */
'use strict';

modules.define('jquery', function (provide, $) {

    /**
     * FastClick: polyfill to remove click delays on browsers with touch UIs.
     *
     * @version 0.6.11
     * @copyright The Financial Times Limited [All Rights Reserved]
     * @license MIT License (see LICENSE.txt)
     */

    /**
     * @class FastClick
     */

    /**
     * Instantiate fast-clicking listeners on the specificed layer.
     *
     * @constructor
     * @param {Element} layer The layer to listen on
     */
    function FastClick(layer) {
        'use strict';
        var oldOnClick,
            self = this;

        /**
         * Whether a click is currently being tracked.
         *
         * @type boolean
         */
        this.trackingClick = false;

        /**
         * Timestamp for when when click tracking started.
         *
         * @type number
         */
        this.trackingClickStart = 0;

        /**
         * The element being tracked for a click.
         *
         * @type EventTarget
         */
        this.targetElement = null;

        /**
         * X-coordinate of touch start event.
         *
         * @type number
         */
        this.touchStartX = 0;

        /**
         * Y-coordinate of touch start event.
         *
         * @type number
         */
        this.touchStartY = 0;

        /**
         * ID of the last touch, retrieved from Touch.identifier.
         *
         * @type number
         */
        this.lastTouchIdentifier = 0;

        /**
         * Touchmove boundary, beyond which a click will be cancelled.
         *
         * @type number
         */
        this.touchBoundary = 10;

        /**
         * The FastClick layer.
         *
         * @type Element
         */
        this.layer = layer;

        if (!layer || !layer.nodeType) {
            throw new TypeError('Layer must be a document node');
        }

        /** @type function() */
        this.onClick = function () {
            return FastClick.prototype.onClick.apply(self, arguments);
        };

        /** @type function() */
        this.onMouse = function () {
            return FastClick.prototype.onMouse.apply(self, arguments);
        };

        /** @type function() */
        this.onTouchStart = function () {
            return FastClick.prototype.onTouchStart.apply(self, arguments);
        };

        /** @type function() */
        this.onTouchMove = function () {
            return FastClick.prototype.onTouchMove.apply(self, arguments);
        };

        /** @type function() */
        this.onTouchEnd = function () {
            return FastClick.prototype.onTouchEnd.apply(self, arguments);
        };

        /** @type function() */
        this.onTouchCancel = function () {
            return FastClick.prototype.onTouchCancel.apply(self, arguments);
        };

        if (FastClick.notNeeded(layer)) {
            return;
        }

        // Set up event handlers as required
        if (this.deviceIsAndroid) {
            layer.addEventListener('mouseover', this.onMouse, true);
            layer.addEventListener('mousedown', this.onMouse, true);
            layer.addEventListener('mouseup', this.onMouse, true);
        }

        layer.addEventListener('click', this.onClick, true);
        layer.addEventListener('touchstart', this.onTouchStart, false);
        layer.addEventListener('touchmove', this.onTouchMove, false);
        layer.addEventListener('touchend', this.onTouchEnd, false);
        layer.addEventListener('touchcancel', this.onTouchCancel, false);

        // Hack is required for browsers that don't support Event#stopImmediatePropagation (e.g. Android 2)
        // which is how FastClick normally stops click events bubbling to callbacks registered on the FastClick
        // layer when they are cancelled.
        if (!Event.prototype.stopImmediatePropagation) {
            layer.removeEventListener = function (type, callback, capture) {
                var rmv = Node.prototype.removeEventListener;
                if (type === 'click') {
                    rmv.call(layer, type, callback.hijacked || callback, capture);
                } else {
                    rmv.call(layer, type, callback, capture);
                }
            };

            layer.addEventListener = function (type, callback, capture) {
                var adv = Node.prototype.addEventListener;
                if (type === 'click') {
                    adv.call(layer, type, callback.hijacked || (callback.hijacked = function (event) {
                        if (!event.propagationStopped) {
                            callback(event);
                        }
                    }), capture);
                } else {
                    adv.call(layer, type, callback, capture);
                }
            };
        }

        // If a handler is already declared in the element's onclick attribute, it will be fired before
        // FastClick's onClick handler. Fix this by pulling out the user-defined handler function and
        // adding it as listener.
        if (typeof layer.onclick === 'function') {

            // Android browser on at least 3.2 requires a new reference to the function in layer.onclick
            // - the old one won't work if passed to addEventListener directly.
            oldOnClick = layer.onclick;
            layer.addEventListener('click', function (event) {
                oldOnClick(event);
            }, false);
            layer.onclick = null;
        }
    }

    /**
     * Android requires exceptions.
     *
     * @type boolean
     */
    FastClick.prototype.deviceIsAndroid = navigator.userAgent.indexOf('Android') > 0;

    /**
     * iOS requires exceptions.
     *
     * @type boolean
     */
    FastClick.prototype.deviceIsIOS = /iP(ad|hone|od)/.test(navigator.userAgent);

    /**
     * iOS 4 requires an exception for select elements.
     *
     * @type boolean
     */
    FastClick.prototype.deviceIsIOS4 = FastClick.prototype.deviceIsIOS && /OS 4_\d(_\d)?/.test(navigator.userAgent);

    /**
     * iOS 6.0(+?) requires the target element to be manually derived
     *
     * @type boolean
     */
    FastClick.prototype.deviceIsIOSWithBadTarget = FastClick.prototype.deviceIsIOS && /OS ([6-9]|\d{2})_\d/.test(navigator.userAgent);

    /**
     * Determine whether a given element requires a native click.
     *
     * @param {EventTarget|Element} target Target DOM element
     * @returns {boolean} Returns true if the element needs a native click
     */
    FastClick.prototype.needsClick = function (target) {
        'use strict';
        switch (target.nodeName.toLowerCase()) {

            // Don't send a synthetic click to disabled inputs (issue #62)
            case 'button':
            case 'select':
            case 'textarea':
                if (target.disabled) {
                    return true;
                }

                break;
            case 'input':

                // File inputs need real clicks on iOS 6 due to a browser bug (issue #68)
                if (this.deviceIsIOS && target.type === 'file' || target.disabled) {
                    return true;
                }

                break;
            case 'label':
            case 'video':
                return true;
        }

        return (/\bneedsclick\b/.test(target.className)
        );
    };

    /**
     * Determine whether a given element requires a call to focus to simulate click into element.
     *
     * @param {EventTarget|Element} target Target DOM element
     * @returns {boolean} Returns true if the element requires a call to focus to simulate native click.
     */
    FastClick.prototype.needsFocus = function (target) {
        'use strict';
        switch (target.nodeName.toLowerCase()) {
            case 'textarea':
                return true;
            case 'select':
                return !this.deviceIsAndroid;
            case 'input':
                switch (target.type) {
                    case 'button':
                    case 'checkbox':
                    case 'file':
                    case 'image':
                    case 'radio':
                    case 'submit':
                        return false;
                }

                // No point in attempting to focus disabled inputs
                return !target.disabled && !target.readOnly;
            default:
                return (/\bneedsfocus\b/.test(target.className)
                );
        }
    };

    /**
     * Send a click event to the specified element.
     *
     * @param {EventTarget|Element} targetElement
     * @param {Event} event
     */
    FastClick.prototype.sendClick = function (targetElement, event) {
        'use strict';
        var clickEvent, touch;

        // On some Android devices activeElement needs to be blurred otherwise the synthetic click will have no effect (#24)
        if (document.activeElement && document.activeElement !== targetElement) {
            document.activeElement.blur();
        }

        touch = event.changedTouches[0];

        // Synthesise a click event, with an extra attribute so it can be tracked
        clickEvent = document.createEvent('MouseEvents');
        clickEvent.initMouseEvent(this.determineEventType(targetElement), true, true, window, 1, touch.screenX, touch.screenY, touch.clientX, touch.clientY, false, false, false, false, 0, null);
        clickEvent.forwardedTouchEvent = true;
        targetElement.dispatchEvent(clickEvent);
    };

    FastClick.prototype.determineEventType = function (targetElement) {
        'use strict';

        //Issue #159: Android Chrome Select Box does not open with a synthetic click event
        if (this.deviceIsAndroid && targetElement.tagName.toLowerCase() === 'select') {
            return 'mousedown';
        }

        return 'click';
    };

    /**
     * @param {EventTarget|Element} targetElement
     */
    FastClick.prototype.focus = function (targetElement) {
        'use strict';
        var length;

        // Issue #160: on iOS 7, some input elements (e.g. date datetime) throw a vague TypeError on setSelectionRange. These elements don't have an integer value for the selectionStart and selectionEnd properties, but unfortunately that can't be used for detection because accessing the properties also throws a TypeError. Just check the type instead. Filed as Apple bug #15122724.
        if (this.deviceIsIOS && targetElement.setSelectionRange && targetElement.type.indexOf('date') !== 0 && targetElement.type !== 'time') {
            length = targetElement.value.length;
            targetElement.setSelectionRange(length, length);
        } else {
            targetElement.focus();
        }
    };

    /**
     * Check whether the given target element is a child of a scrollable layer and if so, set a flag on it.
     *
     * @param {EventTarget|Element} targetElement
     */
    FastClick.prototype.updateScrollParent = function (targetElement) {
        'use strict';
        var scrollParent, parentElement;

        scrollParent = targetElement.fastClickScrollParent;

        // Attempt to discover whether the target element is contained within a scrollable layer. Re-check if the
        // target element was moved to another parent.
        if (!scrollParent || !scrollParent.contains(targetElement)) {
            parentElement = targetElement;
            do {
                if (parentElement.scrollHeight > parentElement.offsetHeight) {
                    scrollParent = parentElement;
                    targetElement.fastClickScrollParent = parentElement;
                    break;
                }

                parentElement = parentElement.parentElement;
            } while (parentElement);
        }

        // Always update the scroll top tracker if possible.
        if (scrollParent) {
            scrollParent.fastClickLastScrollTop = scrollParent.scrollTop;
        }
    };

    /**
     * @param {EventTarget} targetElement
     * @returns {Element|EventTarget}
     */
    FastClick.prototype.getTargetElementFromEventTarget = function (eventTarget) {
        'use strict';

        // On some older browsers (notably Safari on iOS 4.1 - see issue #56) the event target may be a text node.
        if (eventTarget.nodeType === Node.TEXT_NODE) {
            return eventTarget.parentNode;
        }

        return eventTarget;
    };

    /**
     * On touch start, record the position and scroll offset.
     *
     * @param {Event} event
     * @returns {boolean}
     */
    FastClick.prototype.onTouchStart = function (event) {
        'use strict';
        var targetElement, touch, selection;

        // Ignore multiple touches, otherwise pinch-to-zoom is prevented if both fingers are on the FastClick element (issue #111).
        if (event.targetTouches.length > 1) {
            return true;
        }

        targetElement = this.getTargetElementFromEventTarget(event.target);
        touch = event.targetTouches[0];

        if (this.deviceIsIOS) {

            // Only trusted events will deselect text on iOS (issue #49)
            selection = window.getSelection();
            if (selection.rangeCount && !selection.isCollapsed) {
                return true;
            }

            if (!this.deviceIsIOS4) {

                // Weird things happen on iOS when an alert or confirm dialog is opened from a click event callback (issue #23):
                // when the user next taps anywhere else on the page, new touchstart and touchend events are dispatched
                // with the same identifier as the touch event that previously triggered the click that triggered the alert.
                // Sadly, there is an issue on iOS 4 that causes some normal touch events to have the same identifier as an
                // immediately preceeding touch event (issue #52), so this fix is unavailable on that platform.
                if (touch.identifier === this.lastTouchIdentifier) {
                    event.preventDefault();
                    return false;
                }

                this.lastTouchIdentifier = touch.identifier;

                // If the target element is a child of a scrollable layer (using -webkit-overflow-scrolling: touch) and:
                // 1) the user does a fling scroll on the scrollable layer
                // 2) the user stops the fling scroll with another tap
                // then the event.target of the last 'touchend' event will be the element that was under the user's finger
                // when the fling scroll was started, causing FastClick to send a click event to that layer - unless a check
                // is made to ensure that a parent layer was not scrolled before sending a synthetic click (issue #42).
                this.updateScrollParent(targetElement);
            }
        }

        this.trackingClick = true;
        this.trackingClickStart = event.timeStamp;
        this.targetElement = targetElement;

        this.touchStartX = touch.pageX;
        this.touchStartY = touch.pageY;

        // Prevent phantom clicks on fast double-tap (issue #36)
        if (event.timeStamp - this.lastClickTime < 200) {
            event.preventDefault();
        }

        return true;
    };

    /**
     * Based on a touchmove event object, check whether the touch has moved past a boundary since it started.
     *
     * @param {Event} event
     * @returns {boolean}
     */
    FastClick.prototype.touchHasMoved = function (event) {
        'use strict';
        var touch = event.changedTouches[0],
            boundary = this.touchBoundary;

        if (Math.abs(touch.pageX - this.touchStartX) > boundary || Math.abs(touch.pageY - this.touchStartY) > boundary) {
            return true;
        }

        return false;
    };

    /**
     * Update the last position.
     *
     * @param {Event} event
     * @returns {boolean}
     */
    FastClick.prototype.onTouchMove = function (event) {
        'use strict';
        if (!this.trackingClick) {
            return true;
        }

        // If the touch has moved, cancel the click tracking
        if (this.targetElement !== this.getTargetElementFromEventTarget(event.target) || this.touchHasMoved(event)) {
            this.trackingClick = false;
            this.targetElement = null;
        }

        return true;
    };

    /**
     * Attempt to find the labelled control for the given label element.
     *
     * @param {EventTarget|HTMLLabelElement} labelElement
     * @returns {Element|null}
     */
    FastClick.prototype.findControl = function (labelElement) {
        'use strict';

        // Fast path for newer browsers supporting the HTML5 control attribute
        if (labelElement.control !== undefined) {
            return labelElement.control;
        }

        // All browsers under test that support touch events also support the HTML5 htmlFor attribute
        if (labelElement.htmlFor) {
            return document.getElementById(labelElement.htmlFor);
        }

        // If no for attribute exists, attempt to retrieve the first labellable descendant element
        // the list of which is defined here: http://www.w3.org/TR/html5/forms.html#category-label
        return labelElement.querySelector('button, input:not([type=hidden]), keygen, meter, output, progress, select, textarea');
    };

    /**
     * On touch end, determine whether to send a click event at once.
     *
     * @param {Event} event
     * @returns {boolean}
     */
    FastClick.prototype.onTouchEnd = function (event) {
        'use strict';
        var forElement,
            trackingClickStart,
            targetTagName,
            scrollParent,
            touch,
            targetElement = this.targetElement;

        if (!this.trackingClick) {
            return true;
        }

        // Prevent phantom clicks on fast double-tap (issue #36)
        if (event.timeStamp - this.lastClickTime < 200) {
            this.cancelNextClick = true;
            return true;
        }

        // Reset to prevent wrong click cancel on input (issue #156).
        this.cancelNextClick = false;

        this.lastClickTime = event.timeStamp;

        trackingClickStart = this.trackingClickStart;
        this.trackingClick = false;
        this.trackingClickStart = 0;

        // On some iOS devices, the targetElement supplied with the event is invalid if the layer
        // is performing a transition or scroll, and has to be re-detected manually. Note that
        // for this to function correctly, it must be called *after* the event target is checked!
        // See issue #57; also filed as rdar://13048589 .
        if (this.deviceIsIOSWithBadTarget) {
            touch = event.changedTouches[0];

            // In certain cases arguments of elementFromPoint can be negative, so prevent setting targetElement to null
            targetElement = document.elementFromPoint(touch.pageX - window.pageXOffset, touch.pageY - window.pageYOffset) || targetElement;
            targetElement.fastClickScrollParent = this.targetElement.fastClickScrollParent;
        }

        targetTagName = targetElement.tagName.toLowerCase();
        if (targetTagName === 'label') {
            forElement = this.findControl(targetElement);
            if (forElement) {
                this.focus(targetElement);
                if (this.deviceIsAndroid) {
                    return false;
                }

                targetElement = forElement;
            }
        } else if (this.needsFocus(targetElement)) {

            // Case 1: If the touch started a while ago (best guess is 100ms based on tests for issue #36) then focus will be triggered anyway. Return early and unset the target element reference so that the subsequent click will be allowed through.
            // Case 2: Without this exception for input elements tapped when the document is contained in an iframe, then any inputted text won't be visible even though the value attribute is updated as the user types (issue #37).
            if (event.timeStamp - trackingClickStart > 100 || this.deviceIsIOS && window.top !== window && targetTagName === 'input') {
                this.targetElement = null;
                return false;
            }

            this.focus(targetElement);

            // Select elements need the event to go through on iOS 4, otherwise the selector menu won't open.
            if (!this.deviceIsIOS4 || targetTagName !== 'select') {
                this.targetElement = null;
                event.preventDefault();
            }

            return false;
        }

        if (this.deviceIsIOS && !this.deviceIsIOS4) {

            // Don't send a synthetic click event if the target element is contained within a parent layer that was scrolled
            // and this tap is being used to stop the scrolling (usually initiated by a fling - issue #42).
            scrollParent = targetElement.fastClickScrollParent;
            if (scrollParent && scrollParent.fastClickLastScrollTop !== scrollParent.scrollTop) {
                return true;
            }
        }

        // Prevent the actual click from going though - unless the target node is marked as requiring
        // real clicks or if it is in the whitelist in which case only non-programmatic clicks are permitted.
        if (!this.needsClick(targetElement)) {
            event.preventDefault();
            this.sendClick(targetElement, event);
        }

        return false;
    };

    /**
     * On touch cancel, stop tracking the click.
     *
     * @returns {void}
     */
    FastClick.prototype.onTouchCancel = function () {
        'use strict';
        this.trackingClick = false;
        this.targetElement = null;
    };

    /**
     * Determine mouse events which should be permitted.
     *
     * @param {Event} event
     * @returns {boolean}
     */
    FastClick.prototype.onMouse = function (event) {
        'use strict';

        // If a target element was never set (because a touch event was never fired) allow the event
        if (!this.targetElement) {
            return true;
        }

        if (event.forwardedTouchEvent) {
            return true;
        }

        // Programmatically generated events targeting a specific element should be permitted
        if (!event.cancelable) {
            return true;
        }

        // Derive and check the target element to see whether the mouse event needs to be permitted;
        // unless explicitly enabled, prevent non-touch click events from triggering actions,
        // to prevent ghost/doubleclicks.
        if (!this.needsClick(this.targetElement) || this.cancelNextClick) {

            // Prevent any user-added listeners declared on FastClick element from being fired.
            if (event.stopImmediatePropagation) {
                event.stopImmediatePropagation();
            } else {

                // Part of the hack for browsers that don't support Event#stopImmediatePropagation (e.g. Android 2)
                event.propagationStopped = true;
            }

            // Cancel the event
            event.stopPropagation();
            event.preventDefault();

            return false;
        }

        // If the mouse event is permitted, return true for the action to go through.
        return true;
    };

    /**
     * On actual clicks, determine whether this is a touch-generated click, a click action occurring
     * naturally after a delay after a touch (which needs to be cancelled to avoid duplication), or
     * an actual click which should be permitted.
     *
     * @param {Event} event
     * @returns {boolean}
     */
    FastClick.prototype.onClick = function (event) {
        'use strict';
        var permitted;

        // It's possible for another FastClick-like library delivered with third-party code to fire a click event before FastClick does (issue #44). In that case, set the click-tracking flag back to false and return early. This will cause onTouchEnd to return early.
        if (this.trackingClick) {
            this.targetElement = null;
            this.trackingClick = false;
            return true;
        }

        // Very odd behaviour on iOS (issue #18): if a submit element is present inside a form and the user hits enter in the iOS simulator or clicks the Go button on the pop-up OS keyboard the a kind of 'fake' click event will be triggered with the submit-type input element as the target.
        if (event.target.type === 'submit' && event.detail === 0) {
            return true;
        }

        permitted = this.onMouse(event);

        // Only unset targetElement if the click is not permitted. This will ensure that the check for !targetElement in onMouse fails and the browser's click doesn't go through.
        if (!permitted) {
            this.targetElement = null;
        }

        // If clicks are permitted, return true for the action to go through.
        return permitted;
    };

    /**
     * Remove all FastClick's event listeners.
     *
     * @returns {void}
     */
    FastClick.prototype.destroy = function () {
        'use strict';
        var layer = this.layer;

        if (this.deviceIsAndroid) {
            layer.removeEventListener('mouseover', this.onMouse, true);
            layer.removeEventListener('mousedown', this.onMouse, true);
            layer.removeEventListener('mouseup', this.onMouse, true);
        }

        layer.removeEventListener('click', this.onClick, true);
        layer.removeEventListener('touchstart', this.onTouchStart, false);
        layer.removeEventListener('touchmove', this.onTouchMove, false);
        layer.removeEventListener('touchend', this.onTouchEnd, false);
        layer.removeEventListener('touchcancel', this.onTouchCancel, false);
    };

    /**
     * Check whether FastClick is needed.
     *
     * @param {Element} layer The layer to listen on
     */
    FastClick.notNeeded = function (layer) {
        'use strict';
        var metaViewport;

        // Devices that don't support touch don't need FastClick
        if (typeof window.ontouchstart === 'undefined') {
            return true;
        }

        if (/Chrome\/[0-9]+/.test(navigator.userAgent)) {

            // Chrome on Android with user-scalable="no" doesn't need FastClick (issue #89)
            if (FastClick.prototype.deviceIsAndroid) {
                metaViewport = document.querySelector('meta[name=viewport]');
                if (metaViewport && metaViewport.content.indexOf('user-scalable=no') !== -1) {
                    return true;
                }

                // Chrome desktop doesn't need FastClick (issue #15)
            } else {
                    return true;
                }
        }

        // IE10 with -ms-touch-action: none, which disables double-tap-to-zoom (issue #97)
        if (layer.style.msTouchAction === 'none') {
            return true;
        }

        return false;
    };

    /**
     * Factory method for creating a FastClick object
     *
     * @param {Element} layer The layer to listen on
     */
    FastClick.attach = function (layer) {
        'use strict';
        return new FastClick(layer);
    };

    var event = $.event.special.pointerclick = {
        setup: function setup() {
            $(this).on('click', event.handler);
        },

        teardown: function teardown() {
            $(this).off('click', event.handler);
        },

        handler: function handler(e) {
            if (!e.button) {
                e.type = 'pointerclick';
                $.event.dispatch.apply(this, arguments);
                e.type = 'click';
            }
        }
    };

    $(function () {
        FastClick.attach(document.body);
        provide($);
    });
});
'use strict';

;(function (global, factory) {

    if (typeof modules === 'object' && modules.isDefined('jquery')) {
        modules.define('jquery', function (provide, $) {
            factory(this.global, $);
            provide($);
        });
    } else if (typeof jQuery === 'function') {
        factory(global, jQuery);
    }
})(undefined, function (window, $) {

    var jqEvent = $.event;

    // NOTE: Remove jQuery special fixes for pointerevents – we fix them ourself
    delete jqEvent.special.pointerenter;
    delete jqEvent.special.pointerleave;

    if (window.PointerEvent) {
        // Have native PointerEvent support, nothing to do than
        return;
    }

    /*!
     * Most of source code is taken from PointerEvents Polyfill
     * written by Polymer Team (https://github.com/Polymer/PointerEvents)
     * and licensed under the BSD License.
     */

    var doc = document,
        HAS_BITMAP_TYPE = window.MSPointerEvent && typeof window.MSPointerEvent.MSPOINTER_TYPE_MOUSE === 'number',
        undef;

    /*!
     * Returns a snapshot of the event, with writable properties.
     *
     * @param {Event} event An event that contains properties to copy.
     * @returns {Object} An object containing shallow copies of `inEvent`'s
     *    properties.
     */
    function cloneEvent(event) {
        var eventCopy = $.extend(new $.Event(), event);
        if (event.preventDefault) {
            eventCopy.preventDefault = function () {
                event.preventDefault();
            };
        }
        return eventCopy;
    }

    /*!
     * Dispatches the event to the target, taking event's bubbling into account.
     */
    function _dispatchEvent(event, target) {
        return event.bubbles ? jqEvent.trigger(event, null, target) : jqEvent.dispatch.call(target, event);
    }

    var MOUSE_PROPS = {
        bubbles: false,
        cancelable: false,
        view: null,
        detail: null,
        screenX: 0,
        screenY: 0,
        clientX: 0,
        clientY: 0,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        button: 0,
        relatedTarget: null,
        pageX: 0,
        pageY: 0
    },
        mouseProps = Object.keys(MOUSE_PROPS),
        mousePropsLen = mouseProps.length,
        mouseDefaults = mouseProps.map(function (prop) {
        return MOUSE_PROPS[prop];
    });

    /*!
     * Pointer event constructor
     *
     * @param {String} type
     * @param {Object} [params]
     * @returns {Event}
     * @constructor
     */
    function PointerEvent(type, params) {
        params || (params = {});

        var e = $.Event(type);

        // define inherited MouseEvent properties
        for (var i = 0, p; i < mousePropsLen; i++) {
            p = mouseProps[i];
            e[p] = params[p] || mouseDefaults[i];
        }

        e.buttons = params.buttons || 0;

        // add x/y properties aliased to clientX/Y
        e.x = e.clientX;
        e.y = e.clientY;

        // Spec requires that pointers without pressure specified use 0.5 for down
        // state and 0 for up state.
        var pressure = 0;
        if (params.pressure) {
            pressure = params.pressure;
        } else {
            pressure = e.buttons ? 0.5 : 0;
        }

        // define the properties of the PointerEvent interface
        e.pointerId = params.pointerId || 0;
        e.width = params.width || 0;
        e.height = params.height || 0;
        e.pressure = pressure;
        e.tiltX = params.tiltX || 0;
        e.tiltY = params.tiltY || 0;
        e.pointerType = params.pointerType || '';
        e.hwTimestamp = params.hwTimestamp || 0;
        e.isPrimary = params.isPrimary || false;

        // add some common jQuery properties
        e.which = typeof params.which === 'undefined' ? 1 : params.which;

        return e;
    }

    function SparseArrayMap() {
        this.array = [];
        this.size = 0;
    }

    SparseArrayMap.prototype = {
        set: function set(k, v) {
            if (v === undef) {
                return this['delete'](k);
            }
            if (!this.has(k)) {
                this.size++;
            }
            this.array[k] = v;
        },

        has: function has(k) {
            return this.array[k] !== undef;
        },

        'delete': function _delete(k) {
            if (this.has(k)) {
                delete this.array[k];
                this.size--;
            }
        },

        get: function get(k) {
            return this.array[k];
        },

        clear: function clear() {
            this.array.length = 0;
            this.size = 0;
        },

        // return value, key, map
        forEach: function forEach(callback, ctx) {
            return this.array.forEach(function (v, k) {
                callback.call(ctx, v, k, this);
            }, this);
        }
    };

    // jscs:disable requireMultipleVarDecl
    var PointerMap = window.Map && window.Map.prototype.forEach ? Map : SparseArrayMap,
        pointerMap = new PointerMap();

    var dispatcher = {
        eventMap: {},
        eventSourceList: [],

        /*!
         * Add a new event source that will generate pointer events
         */
        registerSource: function registerSource(name, source) {
            var newEvents = source.events;
            if (newEvents) {
                newEvents.forEach(function (e) {
                    source[e] && (this.eventMap[e] = function () {
                        source[e].apply(source, arguments);
                    });
                }, this);
                this.eventSourceList.push(source);
            }
        },

        register: function register(element) {
            var len = this.eventSourceList.length;
            for (var i = 0, es; i < len && (es = this.eventSourceList[i]); i++) {
                // call eventsource register
                es.register.call(es, element);
            }
        },

        unregister: function unregister(element) {
            var l = this.eventSourceList.length;
            for (var i = 0, es; i < l && (es = this.eventSourceList[i]); i++) {
                // call eventsource register
                es.unregister.call(es, element);
            }
        },

        down: function down(event) {
            event.bubbles = true;
            this.fireEvent('pointerdown', event);
        },

        move: function move(event) {
            event.bubbles = true;
            this.fireEvent('pointermove', event);
        },

        up: function up(event) {
            event.bubbles = true;
            this.fireEvent('pointerup', event);
        },

        enter: function enter(event) {
            event.bubbles = false;
            this.fireEvent('pointerenter', event);
        },

        leave: function leave(event) {
            event.bubbles = false;
            this.fireEvent('pointerleave', event);
        },

        over: function over(event) {
            event.bubbles = true;
            this.fireEvent('pointerover', event);
        },

        out: function out(event) {
            event.bubbles = true;
            this.fireEvent('pointerout', event);
        },

        cancel: function cancel(event) {
            event.bubbles = true;
            this.fireEvent('pointercancel', event);
        },

        leaveOut: function leaveOut(event) {
            this.out(event);
            this.enterLeave(event, this.leave);
        },

        enterOver: function enterOver(event) {
            this.over(event);
            this.enterLeave(event, this.enter);
        },

        enterLeave: function enterLeave(event, fn) {
            var target = event.target,
                relatedTarget = event.relatedTarget;

            if (!this.contains(target, relatedTarget)) {
                while (target && target !== relatedTarget) {
                    event.target = target;
                    fn.call(this, event);

                    target = target.parentNode;
                }
            }
        },

        contains: function contains(target, relatedTarget) {
            return target === relatedTarget || $.contains(target, relatedTarget);
        },

        // LISTENER LOGIC
        eventHandler: function eventHandler(e) {
            // This is used to prevent multiple dispatch of pointerevents from
            // platform events. This can happen when two elements in different scopes
            // are set up to create pointer events, which is relevant to Shadow DOM.
            if (e._handledByPE) {
                return;
            }

            var type = e.type,
                fn;
            (fn = this.eventMap && this.eventMap[type]) && fn(e);

            e._handledByPE = true;
        },

        /*!
         * Sets up event listeners
         */
        listen: function listen(target, events) {
            events.forEach(function (e) {
                this.addEvent(target, e);
            }, this);
        },

        /*!
         * Removes event listeners
         */
        unlisten: function unlisten(target, events) {
            events.forEach(function (e) {
                this.removeEvent(target, e);
            }, this);
        },

        addEvent: function addEvent(target, eventName) {
            $(target).on(eventName, boundHandler);
        },

        removeEvent: function removeEvent(target, eventName) {
            $(target).off(eventName, boundHandler);
        },

        getTarget: function getTarget(event) {
            return event._target;
        },

        /*!
         * Creates a new Event of type `type`, based on the information in `event`
         */
        makeEvent: function makeEvent(type, event) {
            var e = new PointerEvent(type, event);
            if (event.preventDefault) {
                e.preventDefault = event.preventDefault;
            }

            e._target = e._target || event.target;

            return e;
        },

        /*!
         * Dispatches the event to its target
         */
        dispatchEvent: function dispatchEvent(event) {
            var target = this.getTarget(event);
            if (target) {
                if (!event.target) {
                    event.target = target;
                }

                return _dispatchEvent(event, target);
            }
        },

        /*!
         * Makes and dispatch an event in one call
         */
        fireEvent: function fireEvent(type, event) {
            var e = this.makeEvent(type, event);
            return this.dispatchEvent(e);
        }
    };

    function boundHandler() {
        dispatcher.eventHandler.apply(dispatcher, arguments);
    }

    var CLICK_COUNT_TIMEOUT = 200,

    // Radius around touchend that swallows mouse events
    MOUSE_DEDUP_DIST = 25,
        MOUSE_POINTER_ID = 1,

    // This should be long enough to ignore compat mouse events made by touch
    TOUCH_DEDUP_TIMEOUT = 2500,

    // A distance for which touchmove should fire pointercancel event
    TOUCHMOVE_HYSTERESIS = 20;

    // handler block for native mouse events
    var mouseEvents = {
        POINTER_TYPE: 'mouse',
        events: ['mousedown', 'mousemove', 'mouseup', 'mouseover', 'mouseout'],

        register: function register(target) {
            dispatcher.listen(target, this.events);
        },

        unregister: function unregister(target) {
            dispatcher.unlisten(target, this.events);
        },

        lastTouches: [],

        // collide with the global mouse listener
        isEventSimulatedFromTouch: function isEventSimulatedFromTouch(event) {
            var lts = this.lastTouches,
                x = event.clientX,
                y = event.clientY;

            for (var i = 0, l = lts.length, t; i < l && (t = lts[i]); i++) {
                // simulated mouse events will be swallowed near a primary touchend
                var dx = Math.abs(x - t.x),
                    dy = Math.abs(y - t.y);
                if (dx <= MOUSE_DEDUP_DIST && dy <= MOUSE_DEDUP_DIST) {
                    return true;
                }
            }
        },

        prepareEvent: function prepareEvent(event) {
            var e = cloneEvent(event);
            e.pointerId = MOUSE_POINTER_ID;
            e.isPrimary = true;
            e.pointerType = this.POINTER_TYPE;
            return e;
        },

        mousedown: function mousedown(event) {
            if (!this.isEventSimulatedFromTouch(event)) {
                if (pointerMap.has(MOUSE_POINTER_ID)) {
                    // http://crbug/149091
                    this.cancel(event);
                }

                pointerMap.set(MOUSE_POINTER_ID, event);

                var e = this.prepareEvent(event);
                dispatcher.down(e);
            }
        },

        mousemove: function mousemove(event) {
            if (!this.isEventSimulatedFromTouch(event)) {
                var e = this.prepareEvent(event);
                dispatcher.move(e);
            }
        },

        mouseup: function mouseup(event) {
            if (!this.isEventSimulatedFromTouch(event)) {
                var p = pointerMap.get(MOUSE_POINTER_ID);
                if (p && p.button === event.button) {
                    var e = this.prepareEvent(event);
                    dispatcher.up(e);
                    this.cleanupMouse();
                }
            }
        },

        mouseover: function mouseover(event) {
            if (!this.isEventSimulatedFromTouch(event)) {
                var e = this.prepareEvent(event);
                dispatcher.enterOver(e);
            }
        },

        mouseout: function mouseout(event) {
            if (!this.isEventSimulatedFromTouch(event)) {
                var e = this.prepareEvent(event);
                dispatcher.leaveOut(e);
            }
        },

        cancel: function cancel(inEvent) {
            var e = this.prepareEvent(inEvent);
            dispatcher.cancel(e);
            this.cleanupMouse();
        },

        cleanupMouse: function cleanupMouse() {
            pointerMap['delete'](MOUSE_POINTER_ID);
        }
    };

    var touchEvents = {
        events: ['touchstart', 'touchmove', 'touchend', 'touchcancel'],

        register: function register(target) {
            dispatcher.listen(target, this.events);
        },

        unregister: function unregister(target) {
            dispatcher.unlisten(target, this.events);
        },

        POINTER_TYPE: 'touch',
        clickCount: 0,
        resetId: null,
        firstTouch: null,

        isPrimaryTouch: function isPrimaryTouch(touch) {
            return this.firstTouch === touch.identifier;
        },

        /*!
         * Sets primary touch if there no pointers, or the only pointer is the mouse
         */
        setPrimaryTouch: function setPrimaryTouch(touch) {
            if (pointerMap.size === 0 || pointerMap.size === 1 && pointerMap.has(MOUSE_POINTER_ID)) {
                this.firstTouch = touch.identifier;
                this.firstXY = { X: touch.clientX, Y: touch.clientY };
                this.scrolling = null;

                this.cancelResetClickCount();
            }
        },

        removePrimaryPointer: function removePrimaryPointer(pointer) {
            if (pointer.isPrimary) {
                this.firstTouch = null;
                // TODO(@narqo): It seems that, flushing `firstXY` flag explicitly in `touchmove` handler is enough.
                // Original code from polymer doing `this.firstXY = null` on every `removePrimaryPointer` call, but looks
                // like it is harmful in some of our usecases.
                this.resetClickCount();
            }
        },

        resetClickCount: function resetClickCount() {
            var _this = this;
            this.resetId = setTimeout(function () {
                _this.clickCount = 0;
                _this.resetId = null;
            }, CLICK_COUNT_TIMEOUT);
        },

        cancelResetClickCount: function cancelResetClickCount() {
            this.resetId && clearTimeout(this.resetId);
        },

        typeToButtons: function typeToButtons(type) {
            return type === 'touchstart' || type === 'touchmove' ? 1 : 0;
        },

        findTarget: function findTarget(event) {
            // Currently we don't interested in shadow dom handling
            return doc.elementFromPoint(event.clientX, event.clientY);
        },

        touchToPointer: function touchToPointer(touch) {
            var cte = this.currentTouchEvent,
                e = cloneEvent(touch);

            // Spec specifies that pointerId 1 is reserved for Mouse.
            // Touch identifiers can start at 0.
            // Add 2 to the touch identifier for compatibility.
            e.pointerId = touch.identifier + 2;
            e.target = this.findTarget(e);
            e.bubbles = true;
            e.cancelable = true;
            e.detail = this.clickCount;
            e.button = 0;
            e.buttons = this.typeToButtons(cte.type);
            e.width = touch.webkitRadiusX || touch.radiusX || 0;
            e.height = touch.webkitRadiusY || touch.radiusY || 0;
            e.pressure = touch.mozPressure || touch.webkitForce || touch.force || 0.5;
            e.isPrimary = this.isPrimaryTouch(touch);
            e.pointerType = this.POINTER_TYPE;

            // forward touch preventDefaults
            var _this = this;
            e.preventDefault = function () {
                _this.scrolling = false;
                _this.firstXY = null;
                cte.preventDefault();
            };

            return e;
        },

        processTouches: function processTouches(event, fn) {
            var tl = event.originalEvent.changedTouches;
            this.currentTouchEvent = event;
            for (var i = 0, t; i < tl.length; i++) {
                t = tl[i];
                fn.call(this, this.touchToPointer(t));
            }
        },

        shouldScroll: function shouldScroll(touchEvent) {
            // return "true" for things to be much easier
            return true;
        },

        findTouch: function findTouch(touches, pointerId) {
            for (var i = 0, l = touches.length, t; i < l && (t = touches[i]); i++) {
                if (t.identifier === pointerId) {
                    return true;
                }
            }
        },

        /*!
         * In some instances, a touchstart can happen without a touchend.
         * This leaves the pointermap in a broken state.
         * Therefore, on every touchstart, we remove the touches
         * that did not fire a touchend event.
         *
         * To keep state globally consistent, we fire a pointercancel
         * for this "abandoned" touch
         */
        vacuumTouches: function vacuumTouches(touchEvent) {
            var touches = touchEvent.touches;
            // `pointermap.size` should be less than length of touches here, as the touchstart has not
            // been processed yet.
            if (pointerMap.size >= touches.length) {
                var d = [];

                pointerMap.forEach(function (pointer, pointerId) {
                    // Never remove pointerId == 1, which is mouse.
                    // Touch identifiers are 2 smaller than their pointerId, which is the
                    // index in pointermap.
                    if (pointerId === MOUSE_POINTER_ID || this.findTouch(touches, pointerId - 2)) return;
                    d.push(pointer.outEvent);
                }, this);

                d.forEach(this.cancelOut, this);
            }
        },

        /*!
         * Prevents synth mouse events from creating pointer events
         */
        dedupSynthMouse: function dedupSynthMouse(touchEvent) {
            var lts = mouseEvents.lastTouches,
                t = touchEvent.changedTouches[0];

            // only the primary finger will synth mouse events
            if (this.isPrimaryTouch(t)) {
                // remember x/y of last touch
                var lt = { x: t.clientX, y: t.clientY };
                lts.push(lt);

                setTimeout(function () {
                    var i = lts.indexOf(lt);
                    i > -1 && lts.splice(i, 1);
                }, TOUCH_DEDUP_TIMEOUT);
            }
        },

        touchstart: function touchstart(event) {
            var touchEvent = event.originalEvent;

            this.vacuumTouches(touchEvent);
            this.setPrimaryTouch(touchEvent.changedTouches[0]);
            this.dedupSynthMouse(touchEvent);

            if (!this.scrolling) {
                this.clickCount++;
                this.processTouches(event, this.overDown);
            }
        },

        touchmove: function touchmove(event) {
            var touchEvent = event.originalEvent;
            if (!this.scrolling) {
                if (this.scrolling === null && this.shouldScroll(touchEvent)) {
                    this.scrolling = true;
                } else {
                    event.preventDefault();
                    this.processTouches(event, this.moveOverOut);
                }
            } else if (this.firstXY) {
                var firstXY = this.firstXY,
                    touch = touchEvent.changedTouches[0],
                    dx = touch.clientX - firstXY.X,
                    dy = touch.clientY - firstXY.Y,
                    dd = Math.sqrt(dx * dx + dy * dy);
                if (dd >= TOUCHMOVE_HYSTERESIS) {
                    this.touchcancel(event);
                    this.scrolling = true;
                    this.firstXY = null;
                }
            }
        },

        touchend: function touchend(event) {
            var touchEvent = event.originalEvent;
            this.dedupSynthMouse(touchEvent);
            this.processTouches(event, this.upOut);
        },

        touchcancel: function touchcancel(event) {
            this.processTouches(event, this.cancelOut);
        },

        overDown: function overDown(pEvent) {
            var target = pEvent.target;
            pointerMap.set(pEvent.pointerId, {
                target: target,
                outTarget: target,
                outEvent: pEvent
            });
            dispatcher.over(pEvent);
            dispatcher.enter(pEvent);
            dispatcher.down(pEvent);
        },

        moveOverOut: function moveOverOut(pEvent) {
            var pointer = pointerMap.get(pEvent.pointerId);

            // a finger drifted off the screen, ignore it
            if (!pointer) {
                return;
            }

            dispatcher.move(pEvent);

            var outEvent = pointer.outEvent,
                outTarget = pointer.outTarget;

            if (outEvent && outTarget !== pEvent.target) {
                pEvent.relatedTarget = outTarget;
                outEvent.relatedTarget = pEvent.target;
                // recover from retargeting by shadow
                outEvent.target = outTarget;

                if (pEvent.target) {
                    dispatcher.leaveOut(outEvent);
                    dispatcher.enterOver(pEvent);
                } else {
                    // clean up case when finger leaves the screen
                    pEvent.target = outTarget;
                    pEvent.relatedTarget = null;
                    this.cancelOut(pEvent);
                }
            }

            pointer.outEvent = pEvent;
            pointer.outTarget = pEvent.target;
        },

        upOut: function upOut(pEvent) {
            dispatcher.up(pEvent);
            dispatcher.out(pEvent);
            dispatcher.leave(pEvent);

            this.cleanUpPointer(pEvent);
        },

        cancelOut: function cancelOut(pEvent) {
            dispatcher.cancel(pEvent);
            dispatcher.out(pEvent);
            dispatcher.leave(pEvent);
            this.cleanUpPointer(pEvent);
        },

        cleanUpPointer: function cleanUpPointer(pEvent) {
            pointerMap['delete'](pEvent.pointerId);
            this.removePrimaryPointer(pEvent);
        }
    };

    var msEvents = {
        events: ['MSPointerDown', 'MSPointerMove', 'MSPointerUp', 'MSPointerOut', 'MSPointerOver', 'MSPointerCancel'],

        register: function register(target) {
            dispatcher.listen(target, this.events);
        },

        unregister: function unregister(target) {
            dispatcher.unlisten(target, this.events);
        },

        POINTER_TYPES: ['', 'unavailable', 'touch', 'pen', 'mouse'],

        prepareEvent: function prepareEvent(event) {
            var e = cloneEvent(event);
            HAS_BITMAP_TYPE && (e.pointerType = this.POINTER_TYPES[event.pointerType]);
            return e;
        },

        MSPointerDown: function MSPointerDown(event) {
            pointerMap.set(event.pointerId, event);
            var e = this.prepareEvent(event);
            dispatcher.down(e);
        },

        MSPointerMove: function MSPointerMove(event) {
            var e = this.prepareEvent(event);
            dispatcher.move(e);
        },

        MSPointerUp: function MSPointerUp(event) {
            var e = this.prepareEvent(event);
            dispatcher.up(e);
            this.cleanup(event.pointerId);
        },

        MSPointerOut: function MSPointerOut(event) {
            var e = this.prepareEvent(event);
            dispatcher.leaveOut(e);
        },

        MSPointerOver: function MSPointerOver(event) {
            var e = this.prepareEvent(event);
            dispatcher.enterOver(e);
        },

        MSPointerCancel: function MSPointerCancel(event) {
            var e = this.prepareEvent(event);
            dispatcher.cancel(e);
            this.cleanup(event.pointerId);
        },

        cleanup: function cleanup(id) {
            pointerMap['delete'](id);
        }
    };

    var navigator = window.navigator;
    if (navigator.msPointerEnabled) {
        dispatcher.registerSource('ms', msEvents);
    } else {
        dispatcher.registerSource('mouse', mouseEvents);
        if (typeof window.ontouchstart !== 'undefined') {
            dispatcher.registerSource('touch', touchEvents);
        }
    }

    dispatcher.register(doc);
});
/**
 * @module tick
 * @description Helpers for polling anything
 */

'use strict';

modules.define('tick', ['inherit', 'events'], function (provide, inherit, events) {

    var TICK_INTERVAL = 50,
        global = this.global,

    /**
     * @class Tick
     * @augments events:Emitter
     */
    Tick = inherit(events.Emitter, /** @lends Tick.prototype */{
        /**
         * @constructor
         */
        __constructor: function __constructor() {
            this._timer = null;
            this._isStarted = false;
        },

        /**
         * Starts polling
         */
        start: function start() {
            if (!this._isStarted) {
                this._isStarted = true;
                this._scheduleTick();
            }
        },

        /**
         * Stops polling
         */
        stop: function stop() {
            if (this._isStarted) {
                this._isStarted = false;
                global.clearTimeout(this._timer);
            }
        },

        _scheduleTick: function _scheduleTick() {
            var _this = this;
            this._timer = global.setTimeout(function () {
                _this._onTick();
            }, TICK_INTERVAL);
        },

        _onTick: function _onTick() {
            this.emit('tick');

            this._isStarted && this._scheduleTick();
        }
    });

    provide(
    /**
     * @exports
     * @type Tick
     */
    new Tick());
});
/**
 * @module idle
 */

'use strict';

modules.define('idle', ['inherit', 'events', 'jquery'], function (provide, inherit, events, $) {

    var IDLE_TIMEOUT = 3000,
        USER_EVENTS = 'mousemove keydown click',

    /**
     * @class Idle
     * @augments events:Emitter
     */
    Idle = inherit(events.Emitter, /** @lends Idle.prototype */{
        /**
         * @constructor
         */
        __constructor: function __constructor() {
            this._timer = null;
            this._isStarted = false;
            this._isIdle = false;
        },

        /**
         * Starts monitoring of idle state
         */
        start: function start() {
            if (!this._isStarted) {
                this._isStarted = true;
                this._startTimer();
                $(document).on(USER_EVENTS, $.proxy(this._onUserAction, this));
            }
        },

        /**
         * Stops monitoring of idle state
         */
        stop: function stop() {
            if (this._isStarted) {
                this._isStarted = false;
                this._stopTimer();
                $(document).off(USER_EVENTS, this._onUserAction);
            }
        },

        /**
         * Returns whether state is idle
         * @returns {Boolean}
         */
        isIdle: function isIdle() {
            return this._isIdle;
        },

        _onUserAction: function _onUserAction() {
            if (this._isIdle) {
                this._isIdle = false;
                this.emit('wakeup');
            }

            this._stopTimer();
            this._startTimer();
        },

        _startTimer: function _startTimer() {
            var _this = this;
            this._timer = setTimeout(function () {
                _this._onTimeout();
            }, IDLE_TIMEOUT);
        },

        _stopTimer: function _stopTimer() {
            this._timer && clearTimeout(this._timer);
        },

        _onTimeout: function _onTimeout() {
            this._isIdle = true;
            this.emit('idle');
        }
    });

    provide(
    /**
     * @exports
     * @type Idle
     */
    new Idle());
});
/**
 * @module input
 */

'use strict';

modules.define('input', function (provide, Input) {

    /**
     * @exports
     * @class input
     * @bem
     */
    provide(Input.decl({ modName: 'has-clear', modVal: true }, /** @lends input.prototype */{
        onSetMod: {
            'js': {
                'inited': function inited() {
                    this.__base.apply(this, arguments);

                    this.on('change', this._updateClear)._updateClear();
                }
            }
        },

        _onClearClick: function _onClearClick() {
            this.setVal('', { source: 'clear' }).setMod('focused');
        },

        _updateClear: function _updateClear() {
            this.toggleMod(this.elem('clear'), 'visible', true, !!this._val);
        }
    }, /** @lends input */{
        live: function live() {
            this.liveBindTo('clear', 'pointerclick', function () {
                this._onClearClick();
            });

            return this.__base.apply(this, arguments);
        }
    }));
});
'use strict';

modules.define('input', function (provide, Input) {

    provide(Input.decl({ modName: 'has-clear', modVal: true }, {
        _onBoxClick: function _onBoxClick() {
            this.hasMod(this.elem('clear'), 'visible') || this.setMod('focused');
        }
    }, {
        live: function live() {
            this.liveBindTo('box', 'pointerclick', function () {
                this._onBoxClick();
            });

            return this.__base.apply(this, arguments);
        }
    }));
});
/**
 * @module checkbox
 */

'use strict';

modules.define('checkbox', ['i-bem__dom', 'control'], function (provide, BEMDOM, Control) {

    /**
     * @exports
     * @class checkbox
     * @augments control
     * @bem
     */
    provide(BEMDOM.decl({ block: this.name, baseBlock: Control }, /** @lends checkbox.prototype */{
        onSetMod: {
            'checked': {
                'true': function _true() {
                    this.elem('control').attr('checked', true);
                },
                '': function _() {
                    this.elem('control').removeAttr('checked');
                }
            }
        },

        _onChange: function _onChange() {
            this.setMod('checked', this.elem('control').prop('checked'));
        }
    }, /** @lends checkbox */{
        live: function live() {
            this.liveBindTo('control', 'change', this.prototype._onChange);
            return this.__base.apply(this, arguments);
        }
    }));
});
/**
 * @module button
 */

'use strict';

modules.define('button', ['i-bem__dom', 'control', 'jquery', 'dom', 'functions', 'keyboard__codes'], function (provide, BEMDOM, Control, $, dom, functions, keyCodes) {

    /**
     * @exports
     * @class button
     * @augments control
     * @bem
     */
    provide(BEMDOM.decl({ block: this.name, baseBlock: Control }, /** @lends button.prototype */{
        beforeSetMod: {
            'pressed': {
                'true': function _true() {
                    return !this.hasMod('disabled') || this.hasMod('togglable');
                }
            },

            'focused': {
                '': function _() {
                    return !this._isPointerPressInProgress;
                }
            }
        },

        onSetMod: {
            'js': {
                'inited': function inited() {
                    this.__base.apply(this, arguments);
                    this._isPointerPressInProgress = false;
                    this._focusedByPointer = false;
                }
            },

            'disabled': {
                'true': function _true() {
                    this.__base.apply(this, arguments);
                    this.hasMod('togglable') || this.delMod('pressed');
                    this.domElem.attr('aria-disabled', true);
                },
                '': function _() {
                    this.__base.apply(this, arguments);
                    this.domElem.removeAttr('aria-disabled');
                }
            },

            'focused': {
                'true': function _true() {
                    this.__base.apply(this, arguments);
                    this._focusedByPointer || this.setMod('focused-hard');
                },

                '': function _() {
                    this.__base.apply(this, arguments);
                    this.delMod('focused-hard');
                }
            }
        },

        /**
         * Returns text of the button
         * @returns {String}
         */
        getText: function getText() {
            return this.elem('text').text();
        },

        /**
         * Sets text to the button
         * @param {String} text
         * @returns {button} this
         */
        setText: function setText(text) {
            this.elem('text').text(text || '');
            return this;
        },

        _onFocus: function _onFocus() {
            if (this._isPointerPressInProgress) return;

            this.__base.apply(this, arguments);
            this.bindTo('control', 'keydown', this._onKeyDown);
        },

        _onBlur: function _onBlur() {
            this.unbindFrom('control', 'keydown', this._onKeyDown).__base.apply(this, arguments);
        },

        _onPointerPress: function _onPointerPress() {
            if (!this.hasMod('disabled')) {
                this._isPointerPressInProgress = true;
                this.bindToDoc('pointerrelease', this._onPointerRelease).setMod('pressed');
            }
        },

        _onPointerRelease: function _onPointerRelease(e) {
            this._isPointerPressInProgress = false;
            this.unbindFromDoc('pointerrelease', this._onPointerRelease);

            if (dom.contains(this.elem('control'), $(e.target))) {
                this._focusedByPointer = true;
                this._focus();
                this._focusedByPointer = false;
                this._updateChecked().emit('click');
            } else {
                this._blur();
            }

            this.delMod('pressed');
        },

        _onKeyDown: function _onKeyDown(e) {
            if (this.hasMod('disabled')) return;

            var keyCode = e.keyCode;
            if (keyCode === keyCodes.SPACE || keyCode === keyCodes.ENTER) {
                this.unbindFrom('control', 'keydown', this._onKeyDown).bindTo('control', 'keyup', this._onKeyUp)._updateChecked().setMod('pressed');
            }
        },

        _onKeyUp: function _onKeyUp(e) {
            this.unbindFrom('control', 'keyup', this._onKeyUp).bindTo('control', 'keydown', this._onKeyDown).delMod('pressed');

            e.keyCode === keyCodes.SPACE && this._doAction();

            this.emit('click');
        },

        _updateChecked: function _updateChecked() {
            this.hasMod('togglable') && (this.hasMod('togglable', 'check') ? this.toggleMod('checked') : this.setMod('checked'));

            return this;
        },

        _doAction: functions.noop
    }, /** @lends button */{
        live: function live() {
            this.liveBindTo('control', 'pointerpress', this.prototype._onPointerPress);
            return this.__base.apply(this, arguments);
        }
    }));
});
/**
 * @module keyboard__codes
 */
'use strict';

modules.define('keyboard__codes', function (provide) {

    provide( /** @exports */{
        /** @type {Number} */
        BACKSPACE: 8,
        /** @type {Number} */
        TAB: 9,
        /** @type {Number} */
        ENTER: 13,
        /** @type {Number} */
        CAPS_LOCK: 20,
        /** @type {Number} */
        ESC: 27,
        /** @type {Number} */
        SPACE: 32,
        /** @type {Number} */
        PAGE_UP: 33,
        /** @type {Number} */
        PAGE_DOWN: 34,
        /** @type {Number} */
        END: 35,
        /** @type {Number} */
        HOME: 36,
        /** @type {Number} */
        LEFT: 37,
        /** @type {Number} */
        UP: 38,
        /** @type {Number} */
        RIGHT: 39,
        /** @type {Number} */
        DOWN: 40,
        /** @type {Number} */
        INSERT: 45,
        /** @type {Number} */
        DELETE: 46
    });
});
/**
 * @module button
 */

'use strict';

modules.define('button', function (provide, Button) {

    /**
     * @exports
     * @class button
     * @bem
     */
    provide(Button.decl({ modName: 'togglable' }, /** @lends button.prototype */{
        onSetMod: {
            'checked': function checked(_, modVal) {
                this.__base.apply(this, arguments);
                this.domElem.attr('aria-pressed', !!modVal);
            }
        }
    }));
});
/**
 * @module radio-group
 */

'use strict';

modules.define('radio-group', ['i-bem__dom', 'jquery', 'dom', 'radio'], function (provide, BEMDOM, $, dom) {

    var undef;
    /**
     * @exports
     * @class radio-group
     * @bem
     */
    provide(BEMDOM.decl(this.name, /** @lends radio-group.prototype */{
        beforeSetMod: {
            'focused': {
                'true': function _true() {
                    return !this.hasMod('disabled');
                }
            }
        },

        onSetMod: {
            'js': {
                'inited': function inited() {
                    this._checkedRadio = this.findBlockInside({
                        block: 'radio',
                        modName: 'checked',
                        modVal: true
                    });

                    this._inSetVal = false;
                    this._val = this._checkedRadio ? this._checkedRadio.getVal() : undef;
                    this._radios = undef;
                }
            },

            'disabled': function disabled(modName, modVal) {
                this.getRadios().forEach(function (option) {
                    option.setMod(modName, modVal);
                });
            },

            'focused': {
                'true': function _true() {
                    if (dom.containsFocus(this.domElem)) return;

                    var radios = this.getRadios(),
                        i = 0,
                        radio;

                    while (radio = radios[i++]) {
                        if (radio.setMod('focused').hasMod('focused')) {
                            // we need to be sure that radio has got focus
                            return;
                        }
                    }
                },

                '': function _() {
                    var focusedRadio = this.findBlockInside({
                        block: 'radio',
                        modName: 'focused',
                        modVal: true
                    });

                    focusedRadio && focusedRadio.delMod('focused');
                }
            }
        },

        /**
         * Returns control value
         * @returns {String}
         */
        getVal: function getVal() {
            return this._val;
        },

        /**
         * Sets control value
         * @param {String} val value
         * @param {Object} [data] additional data
         * @returns {radio-group} this
         */
        setVal: function setVal(val, data) {
            var isValUndef = val === undef;

            isValUndef || (val = String(val));

            if (this._val !== val) {
                if (isValUndef) {
                    this._val = undef;
                    this._checkedRadio.delMod('checked');
                    this.emit('change', data);
                } else {
                    var radio = this._getRadioByVal(val);
                    if (radio) {
                        this._inSetVal = true;

                        this._val !== undef && this._getRadioByVal(this._val).delMod('checked');
                        this._val = radio.getVal();
                        radio.setMod('checked');

                        this._inSetVal = false;
                        this.emit('change', data);
                    }
                }
            }

            return this;
        },

        /**
         * Returns name of control
         * @returns {String}
         */
        getName: function getName() {
            return this.getRadios()[0].getName();
        },

        /**
         * Returns options
         * @returns {radio[]}
         */
        getRadios: function getRadios() {
            return this._radios || (this._radios = this.findBlocksInside('radio'));
        },

        _getRadioByVal: function _getRadioByVal(val) {
            var radios = this.getRadios(),
                i = 0,
                option;

            while (option = radios[i++]) {
                if (option.getVal() === val) {
                    return option;
                }
            }
        },

        _onRadioCheck: function _onRadioCheck(e) {
            var radioVal = (this._checkedRadio = e.target).getVal();
            if (!this._inSetVal) {
                if (this._val === radioVal) {
                    // on block init value set in constructor, we need remove old checked and emit "change" event
                    this.getRadios().forEach(function (radio) {
                        radio.getVal() !== radioVal && radio.delMod('checked');
                    });
                    this.emit('change');
                } else {
                    this.setVal(radioVal);
                }
            }
        },

        _onRadioFocus: function _onRadioFocus(e) {
            this.setMod('focused', e.target.getMod('focused'));
        }
    }, /** @lends radio-group */{
        live: function live() {
            var ptp = this.prototype;
            this.liveInitOnBlockInsideEvent({ modName: 'checked', modVal: true }, 'radio', ptp._onRadioCheck).liveInitOnBlockInsideEvent({ modName: 'focused', modVal: '*' }, 'radio', ptp._onRadioFocus);
        }
    }));
});
/**
 * @module radio
 */

'use strict';

modules.define('radio', ['i-bem__dom', 'control'], function (provide, BEMDOM, Control) {

    /**
     * @exports
     * @class radio
     * @augments control
     * @bem
     */
    provide(BEMDOM.decl({ block: this.name, baseBlock: Control }, /** @lends radio.prototype */{
        onSetMod: {
            'checked': {
                'true': function _true() {
                    this.elem('control').attr('checked', true);
                },
                '': function _() {
                    this.elem('control').removeAttr('checked');
                }
            }
        },

        _onChange: function _onChange() {
            this.hasMod('disabled') || this.setMod('checked');
        }
    }, /** @lends radio */{
        live: function live() {
            this.liveBindTo('change', this.prototype._onChange);
            return this.__base.apply(this, arguments);
        }
    }));
});
/**
 * Auto initialization on DOM ready
 */

'use strict';

modules.require(['i-bem__dom_init', 'jquery', 'next-tick'], function (init, $, nextTick) {

    $(function () {
        nextTick(init);
    });
});
/**
 * @module loader_type_js
 * @description Load JS from external URL.
 */

'use strict';

modules.define('loader_type_js', function (provide) {

    var loading = {},
        loaded = {},
        head = document.getElementsByTagName('head')[0],
        runCallbacks = function runCallbacks(path, type) {
        var cbs = loading[path],
            cb,
            i = 0;
        delete loading[path];
        while (cb = cbs[i++]) {
            cb[type] && cb[type]();
        }
    },
        onSuccess = function onSuccess(path) {
        loaded[path] = true;
        runCallbacks(path, 'success');
    },
        onError = function onError(path) {
        runCallbacks(path, 'error');
    };

    provide(
    /**
     * @exports
     * @param {String} path resource link
     * @param {Function} [success] to be called if the script succeeds
     * @param {Function} [error] to be called if the script fails
     */
    function (path, success, error) {
        if (loaded[path]) {
            success && success();
            return;
        }

        if (loading[path]) {
            loading[path].push({ success: success, error: error });
            return;
        }

        loading[path] = [{ success: success, error: error }];

        var script = document.createElement('script');
        script.type = 'text/javascript';
        script.charset = 'utf-8';
        script.src = (location.protocol === 'file:' && !path.indexOf('//') ? 'http:' : '') + path;

        if ('onload' in script) {
            script.onload = function () {
                script.onload = script.onerror = null;
                onSuccess(path);
            };

            script.onerror = function () {
                script.onload = script.onerror = null;
                onError(path);
            };
        } else {
            script.onreadystatechange = function () {
                var readyState = this.readyState;
                if (readyState === 'loaded' || readyState === 'complete') {
                    script.onreadystatechange = null;
                    onSuccess(path);
                }
            };
        }

        head.insertBefore(script, head.lastChild);
    });
});
'use strict';

modules.define('jquery', function (provide, $) {

    $.each({
        pointerpress: 'pointerdown',
        pointerrelease: 'pointerup pointercancel'
    }, function (spec, origEvent) {
        function eventHandler(e) {
            var res,
                origType = e.handleObj.origType;

            if (e.which === 1) {
                e.type = spec;
                res = $.event.dispatch.apply(this, arguments);
                e.type = origType;
            }

            return res;
        }

        $.event.special[spec] = {
            setup: function setup() {
                $(this).on(origEvent, eventHandler);
                return false;
            },
            teardown: function teardown() {
                $(this).off(origEvent, eventHandler);
                return false;
            }
        };
    });

    provide($);
});
/**
 * @module radio
 */

'use strict';

modules.define('radio', ['button'], function (provide, _, Radio) {

    /**
     * @exports
     * @class radio
     * @bem
     */
    provide(Radio.decl({ modName: 'type', modVal: 'button' }, /** @lends radio.prototype */{
        onSetMod: {
            'js': {
                'inited': function inited() {
                    this.__base.apply(this, arguments);
                    this._button = this.findBlockInside('button').on({ modName: 'checked', modVal: '*' }, proxyModFromButton, this).on({ modName: 'focused', modVal: '*' }, proxyModFromButton, this);
                }
            },

            'checked': proxyModToButton,
            'disabled': proxyModToButton,
            'focused': function focused(modName, modVal) {
                proxyModToButton.call(this, modName, modVal, false);
            }
        }
    }, /** @lends radio */{
        live: function live() {
            this.liveInitOnBlockInsideEvent({ modName: 'js', modVal: 'inited' }, 'button');
            return this.__base.apply(this, arguments);
        }
    }));

    function proxyModToButton(modName, modVal, callBase) {
        callBase !== false && this.__base.apply(this, arguments);
        this._button.setMod(modName, modVal);
    }

    function proxyModFromButton(_, data) {
        this.setMod(data.modName, data.modVal);
    }
});