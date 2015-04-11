/*
 * Copyright 2015 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

module Shumway.AVM1 {

  /**
   * Base class for object instances we prefer to not inherit Object.prototype properties.
   */
  export class NullPrototypeObject { }
  // Just assigning class prototype to null will not work, using next best thing.
  NullPrototypeObject.prototype = Object.create(null);

  // Implementing object structure and metaobject protocol very similar to
  // the one documented in the ECMAScript language 3.0 specification.

  // ActionScript properties flags.
  // DONT_ENUM, DONT_DELETE, and READ_ONLY are mapped to the the ASSetPropFlags.
  export enum AVM1PropertyFlags {
    DONT_ENUM = 1,
    DONT_DELETE = 2,
    READ_ONLY = 4,
    DATA = 64,
    ACCESSOR = 128,
    NATIVE_MEMBER = DATA | DONT_DELETE | DONT_ENUM,
    NATIVE_ACCESSOR = ACCESSOR | DONT_DELETE | DONT_ENUM,
    ASSETPROP_MASK = DONT_DELETE | DONT_ENUM | READ_ONLY
  }

  export enum AVM1DefaultValueHint {
    NUMBER,
    STRING
  }

  export interface IAVM1Callable {
    alCall(thisArg: any, args?: any[]): any;
  }

  export interface AVM1PropertyDescriptor {
    flags: AVM1PropertyFlags;
    value?: any;
    get?: IAVM1Callable;
    set?: IAVM1Callable;
    id?: string;
  }

  var ESCAPED_PROPERTY_PREFIX = '__avm1';
  var DEBUG_PROPERTY_PREFIX = '$Bg';

  export interface IAVM1Builtins {
    Object: AVM1Object;
    Function: AVM1Object;
    Boolean: AVM1Object;
    Number: AVM1Object;
    String: AVM1Object;
    Array: AVM1Object;
    Date: AVM1Object;
    Math: AVM1Object;
  }

  export interface IAVM1Context {
    builtins: IAVM1Builtins;
    swfVersion: number;
    isPropertyCaseSensitive: boolean;
    registerClass(name: string, cls: AVM1Object): void;
  }

  /**
   * Base class for the ActionScript AVM1 object.
   */
  export class AVM1Object extends NullPrototypeObject implements IAVM1Callable {
    // Using our own bag of properties
    private _ownProperties: any;
    private _prototype: AVM1Object;

    private _avm1Context: IAVM1Context;

    public get context(): AVM1Context { // too painful to have it as IAVM1Context
      return <AVM1Context>this._avm1Context;
    }

    public constructor(avm1Context: IAVM1Context) {
      false && super();
      this._avm1Context = avm1Context;
      this._ownProperties = Object.create(null);
      this._prototype = null;

      var self = this;
      // Using IAVM1Callable here to avoid circular calls between AVM1Object and
      // AVM1Function during constructions.
      // TODO do we need to support __proto__ for all SWF versions?
      this.alSetOwnProperty('__proto__', {
        flags: AVM1PropertyFlags.ACCESSOR | AVM1PropertyFlags.DONT_DELETE | AVM1PropertyFlags.DONT_ENUM,
        get: { alCall: function (thisArg: any, args?: any[]): any { return self.alPrototype; }},
        set: { alCall: function (thisArg: any, args?: any[]): any { self.alPrototype = args[0]; }}
      });
    }

    get alPrototype(): AVM1Object {
      return this._prototype;
    }

    set alPrototype(v: AVM1Object) {
      // checking for circular references
      var p = v;
      while (p) {
        if (p === this) {
          return; // possible loop in __proto__ chain is found
        }
        p = p.alPrototype;
      }
      // TODO recursive chain check
      this._prototype = v;
    }

    public alGetPrototypeProperty(): any {
      return this.alGet('prototype');
    }

    // TODO shall we add mode for readonly/native flags of the prototype property?
    public alSetOwnPrototypeProperty(v: any): void {
      this.alSetOwnProperty('prototype', {
        flags: AVM1PropertyFlags.DATA | AVM1PropertyFlags.DONT_ENUM,
        value: v
      });
    }

    public alGetConstructorProperty(): any {
      return this.alGet('__constructor__');
    }

    public alSetOwnConstructorProperty(v: any): void {
      this.alSetOwnProperty('__constructor__', {
        flags: AVM1PropertyFlags.DATA | AVM1PropertyFlags.DONT_ENUM,
        value: v
      });
    }

    _escapeProperty(p: any): string  {
      var context = this.context;
      var name = alToString(context, p);
      if (!context.isPropertyCaseSensitive) {
        name = name.toUpperCase();
      }
      if (name[0] === '_') {
        name = ESCAPED_PROPERTY_PREFIX + name
      }
      return name;
    }

    _unescapeProperty(name: string): string {
      if (name[0] === '_' && name.indexOf(ESCAPED_PROPERTY_PREFIX) === 0) {
        name = name.substring(ESCAPED_PROPERTY_PREFIX.length);
      }
      return name;
    }

    _debugEscapeProperty(p: any): string {
      var context = this.context;
      var name = alToString(context, p);
      if (!context.isPropertyCaseSensitive) {
        name = name.toUpperCase();
      }
      return DEBUG_PROPERTY_PREFIX + name;
    }

    public alGetOwnProperty(p): AVM1PropertyDescriptor {
      var name = this._escapeProperty(p);
      return this._ownProperties[name];
    }

    public alSetOwnProperty(p, desc: AVM1PropertyDescriptor): void {
      var name = this._escapeProperty(p);
      this._ownProperties[name] = desc;
      if (!release) { // adding data property on the main object for convenience of debugging
        if ((desc.flags & AVM1PropertyFlags.DATA) &&
            !(desc.flags & AVM1PropertyFlags.DONT_ENUM)) {
          Object.defineProperty(this, this._debugEscapeProperty(p),
            {value: desc.value, enumerable: true, configurable: true});
        }
      }
    }

    public alHasOwnProperty(p): boolean  {
      var name = this._escapeProperty(p);
      return !!this._ownProperties[name];
    }

    public alDeleteOwnProperty(p) {
      var name = this._escapeProperty(p);
      delete this._ownProperties[name];
      if (!release) {
        delete this[this._debugEscapeProperty(p)];
      }
    }

    public alGetOwnPropertiesKeys(): string[] {
      var keys: string[] = [];
      for (var i in this._ownProperties) {
        var desc = this._ownProperties[i];
        if (!(desc.flags & AVM1PropertyFlags.DONT_ENUM)) {
          var name = this._unescapeProperty(i);
          keys.push(name);
        }
      }
      return keys;
    }

    public alGetProperty(p): AVM1PropertyDescriptor {
      var desc = this.alGetOwnProperty(p);
      if (desc) {
        return desc;
      }
      if (!this._prototype) {
        return undefined;
      }
      return this._prototype.alGetProperty(p);
    }

    public alGet(p): any {
      var desc = this.alGetProperty(p);
      if (!desc) {
        return undefined;
      }
      if ((desc.flags & AVM1PropertyFlags.DATA)) {
        return desc.value;
      }
      release || Debug.assert((desc.flags & AVM1PropertyFlags.ACCESSOR));
      var getter = desc.get;
      if (!getter) {
        return undefined;
      }
      return getter.alCall(this);
    }

    public alCanPut(p): boolean {
      var desc = this.alGetOwnProperty(p);
      if (desc) {
        if ((desc.flags & AVM1PropertyFlags.ACCESSOR)) {
          return !!desc.set;
        } else {
          return !(desc.flags & AVM1PropertyFlags.READ_ONLY);
        }
      }
      var proto = this._prototype;
      if (!proto) {
        return true;
      }
      return proto.alCanPut(p);
    }

    public alPut(p, v) {
      if (!this.alCanPut(p)) {
        return;
      }
      var ownDesc = this.alGetOwnProperty(p);
      if (ownDesc && (ownDesc.flags & AVM1PropertyFlags.DATA)) {
        var newDesc: AVM1PropertyDescriptor = {
          flags: AVM1PropertyFlags.DATA,
          value: v
        };
        this.alSetOwnProperty(p, newDesc);
        return;
      }
      var desc = this.alGetProperty(p);
      if (desc && (desc.flags & AVM1PropertyFlags.ACCESSOR)) {
        var setter = desc.set;
        release || Debug.assert(setter);
        setter.alCall(this, [v]);
      } else {
        var newDesc: AVM1PropertyDescriptor = {
          flags: AVM1PropertyFlags.DATA,
          value: v
        };
        this.alSetOwnProperty(p, newDesc);
      }
    }

    public alHasProperty(p): boolean  {
      var desc = this.alGetProperty(p);
      return !!desc;
    }

    public alDeleteProperty(p): boolean {
      var desc = this.alGetOwnProperty(p);
      if (!desc) {
        return true;
      }
      if ((desc.flags & AVM1PropertyFlags.DONT_DELETE)) {
        return false;
      }
      this.alDeleteOwnProperty(p);
      return true;
    }

    public alDefaultValue(hint: AVM1DefaultValueHint = AVM1DefaultValueHint.NUMBER): any {
      if (hint === AVM1DefaultValueHint.STRING) {
        var toString = this.alGet('toString');
        if (alIsFunction(toString)) {
          var str = toString.alCall(this);
          return str;
        }
        var valueOf = this.alGet('valueOf');
        if (alIsFunction(valueOf)) {
          var val = valueOf.alCall(this);
          return val;
        }
      } else {
        release || Debug.assert(hint === AVM1DefaultValueHint.NUMBER);
        var valueOf = this.alGet('valueOf');
        if (alIsFunction(valueOf)) {
          var val = valueOf.alCall(this);
          return val;
        }
        var toString = this.alGet('toString');
        if (alIsFunction(toString)) {
          var str = toString.alCall(this);
          return str;
        }
      }
      // TODO is this a default?
      return this;
    }

    // TODO shall we initially define alConstruct and alCall in the AVM1Function?
    public alConstruct(args?: any[]): AVM1Object {
      throw new Error('not implemented AVM1Object.alConstruct');
    }

    public alCall(thisArg: any, args?: any[]): any {
      throw new Error('not implemented AVM1Object.alCall');
    }

    public alGetKeys(): string[] {
      var ownKeys = this.alGetOwnPropertiesKeys();
      var proto = this._prototype;
      if (!proto) {
        return ownKeys;
      }

      var otherKeys = proto.alGetKeys();
      if (ownKeys.length === 0) {
        return otherKeys;
      }

      // Merging two keys sets
      // TODO check if we shall worry about __proto__ usage here
      var processed = Object.create(null);
      for (var i = 0; i < ownKeys.length; i++) {
        processed[ownKeys[i]] = true;
      }
      for (var i = 0; i < otherKeys.length; i++) {
        processed[otherKeys[i]] = true;
      }
      return Object.getOwnPropertyNames(processed);
    }
  }

  /**
   * Base class for ActionsScript functions.
   */
  export class AVM1Function extends AVM1Object {
    public constructor(context: IAVM1Context) {
      super(context);
      this.alPrototype = context.builtins.Function.alGetPrototypeProperty();
      this.alSetOwnConstructorProperty(context.builtins.Function);
    }

    /**
     * Wraps the function to the callable JavaScript function.
     * @returns {Function} a JavaScript function.
     */
    public toJSFunction(): Function {
      var fn = this;
      return function () {
        return fn.alCall(null, Array.prototype.slice.call(arguments, 0));
      };
    }
  }

  /**
   * Base class for ActionScript functions with native JavaScript implementation.
   */
  export class AVM1NativeFunction extends AVM1Function {
    private _fn: Function;
    private _ctor: Function;

    /**
     * @param {IAVM1Context} context
     * @param {Function} fn The native function for regular calling.
     * @param {Function} ctor The native function for construction.
     */
    public constructor(context: IAVM1Context, fn: Function, ctor?: Function) {
      super(context);
      this._fn = fn;
      if (ctor) {
        this._ctor = ctor;
      }
    }

    public alConstruct(args?: any[]): AVM1Object {
      if (!this._ctor) {
        throw new Error('not a constructor');
      }
      return this._ctor.apply(this, args);
    }

    public alCall(thisArg: any, args?: any[]): any {
      if (!this._fn) {
        throw new Error('not callable');
      }
      return this._fn.apply(thisArg, args);
    }
  }

  /**
   * Base class the is used for the interpreter.
   * See {AVM1InterpretedFunction} implementation
   */
  export class AVM1EvalFunction extends AVM1Function {
    public constructor(context: IAVM1Context) {
      super(context);
      this.alSetOwnPrototypeProperty(alNewObject(context));
    }
    public alConstruct(args?: any[]): AVM1Object  {
      var obj = new AVM1Object(this.context);
      var objPrototype = this.alGetPrototypeProperty();
      if (!(objPrototype instanceof AVM1Object)) {
        objPrototype = this.context.builtins.Object.alGetPrototypeProperty();
      }
      obj.alPrototype = objPrototype;
      obj.alSetOwnConstructorProperty(this);
      var result = this.alCall(obj, args);
      return result instanceof AVM1Object ? result : obj;
    }
  }

  // TODO create classes for the ActionScript errors.

  function AVM1TypeError(msg?) {
  }
  AVM1TypeError.prototype = Object.create(Error.prototype);

  export function alToPrimitive(context: IAVM1Context, v, preferredType?: AVM1DefaultValueHint) {
    if (!(v instanceof AVM1Object)) {
      return v;
    }
    var obj: AVM1Object = v;
    return preferredType !== undefined ? obj.alDefaultValue(preferredType) : obj.alDefaultValue();
  }

  export function alToBoolean(context: IAVM1Context, v): boolean {
    switch (typeof v) {
      case 'undefined':
        return false;
      case 'object':
        return v !== null;
      case 'boolean':
        return v;
      case 'string':
      case 'number':
        return !!v;
      default:
        release || Debug.assert(false);
    }
  }

  export function alToNumber(context: IAVM1Context, v): number {
    if (typeof v === 'object' && v !== null) {
      v = alToPrimitive(context, v, AVM1DefaultValueHint.NUMBER);
    }
    switch (typeof v) {
      case 'undefined':
        return context.swfVersion >= 7 ? NaN : 0;
      case 'object':
        if (v === null) {
          return context.swfVersion >= 7 ? NaN : 0;
        }
        return context.swfVersion >= 5 ? NaN : 0;
      case 'boolean':
        return v ? 1 : 0;
      case 'number':
        return v;
      case 'string':
        if (v === '' && context.swfVersion < 5) {
          return 0;
        }
        return +v;
      default:
        release || Debug.assert(false);
    }
  }

  export function alToInteger(context: IAVM1Context, v): number {
    var n = alToNumber(context, v);
    if (isNaN(n)) {
      return 0;
    }
    if (n === 0 || n === Number.POSITIVE_INFINITY || n === Number.NEGATIVE_INFINITY) {
      return n;
    }
    return n < 0 ? Math.ceil(n) : Math.floor(n);
  }

  export function alToInt32(context: IAVM1Context, v): number  {
    var n = alToNumber(context, v);
    return n | 0;
  }

  export function alToString(context: IAVM1Context, v): string {
    if (typeof v === 'object' && v !== null) {
      v = alToPrimitive(context, v, AVM1DefaultValueHint.STRING);
    }
    switch (typeof v) {
      case 'undefined':
        return context.swfVersion >= 7 ? 'undefined' : '';
      case 'object':
        if (v === null) {
          return 'null';
        }
        return '[type ' + alGetObjectClass(v) + ']';
      case 'boolean':
        return v ? 'true' : 'false';
      case 'number':
        return v + '';
      case 'string':
        return v;
      default:
        release || Debug.assert(false);
    }
  }

  export function alToObject(context: IAVM1Context, v): AVM1Object {
    switch (typeof v) {
      case 'undefined':
        throw new AVM1TypeError();
      case 'object':
        if (v === null) {
          throw new AVM1TypeError();
        }
        // TODO verify if all objects here are inherited from AVM1Object
        if (Array.isArray(v)) {
          return new Natives.AVM1ArrayNative(context, v);
        }
        return v;
      case 'boolean':
        return new Natives.AVM1BooleanNative(context, v);
      case 'number':
        return new Natives.AVM1NumberNative(context, v);
      case 'string':
        return new Natives.AVM1StringNative(context, v);
      default:
        release || Debug.assert(false);
    }
  }

  export function alNewObject(context: IAVM1Context): AVM1Object {
    var obj = new AVM1Object(context);
    obj.alPrototype = context.builtins.Object.alGetPrototypeProperty();
    obj.alSetOwnConstructorProperty(context.builtins.Object);
    return obj;
  }

  export function alGetObjectClass(obj: AVM1Object): string  {
    if (obj instanceof AVM1Function) {
      return 'Function';
    }
    // TODO more cases
    return 'Object';
  }

  export function alCoerceString(context: IAVM1Context, x): string {
    if (x instanceof AVM1Object) {
      return alToString(context, x);
    }
    return Shumway.AVMX.axCoerceString(x);
  }

  export function alIsIndex(context: IAVM1Context, p) {
    if (p instanceof AVM1Object) {
      return isIndex(alToString(context, p));
    }
    return isIndex(p);
  }

  export function alForEachProperty(obj: AVM1Object, fn: (name: string) => void, thisArg?: any) {
    obj.alGetKeys().forEach(fn, thisArg);
  }

  export function alIsFunction(obj: any): boolean  {
    return obj instanceof AVM1Function;
  }

  export function alCallProperty(obj: AVM1Object, p, args?: any[]): any {
    var callable: IAVM1Callable = obj.alGet(p);
    callable.alCall(obj, args);
  }

  export function alInstanceOf(context: IAVM1Context, obj, cls): boolean  {
    if (!(obj instanceof AVM1Object)) {
      return false;
    }
    if (!(cls instanceof AVM1Object)) {
      return false;
    }
    var proto = cls.alGetPrototypeProperty();
    for (var i = obj; i; i = i.alPrototype) {
      if (i === proto) {
        return true;
      }
    }
    return false;
  }

  export function alIsArray(context: IAVM1Context, v): boolean  {
    return alInstanceOf(context, v, context.builtins.Array);
  }

  export function alIsString(context: IAVM1Context, v): boolean {
    return typeof v === 'string';
  }
}