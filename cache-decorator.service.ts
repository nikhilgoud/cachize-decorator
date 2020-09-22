import { Observable } from 'rxjs/internal/Observable';
import { Subject } from 'rxjs/internal/Subject';
import { tap } from 'rxjs/operators';

interface ICache {
  expired: number;
  data: any;
}
export interface CachizeOptions {
  ttl?: number;
  async?: boolean;
  log?: boolean;
}

declare type hashFn = (_?: any) => string;

import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CacheService {
  public keyIncrementer = 0;
  constructor() {}

  /**
   *
   * @param {Observable<any>} fallback
   * @param {Function | string} [keyHash] Unique Key
   * @param {{ ttl?: number | false;  async?: boolean; log: boolean }}
   * [options={ ttl: 1800000, async: true, log: true }] - config options
   *
   *
   * ttl (DEFAULT: 30min): time-to-live
   *
   * async (DEFAULT: true): whether the original method is asynchronous (returns Observable)
   *
   * log (DEFAULT: false) print to console for each cache getter
   *
   * key structure - prefix : __cached_val_, suffix will be method's name & its argument combinations (uniqueness)
   *
   * USAGES:
   * import CacheService from 'cache-decorator-service';
   * ...
   * constructor(private readonly cacheService: CacheService){}
   *
   * @example
   *
   *   return this.cacheService.get(this.http.get('/api/accounts'));
   *   return this.cacheService.get(this.http.get('/api/accounts'), 'somekey');
   *   return this.cacheService.get(this.http.get('/api/accounts'), 'somekey', { log: true });
   *   return this.cacheService.get(this.http.get('/api/accounts'), (params: any) => `key_${params}`,);
   *   return this.cacheService.get(this.http.get('/api/accounts'), (params: any) => `key_${params}`, { log: true });
   */
  get(
    fallback: Observable<any>,
    keyHash?: hashFn | string,
    options: CachizeOptions = { ttl: 1800000, async: true, log: true }
  ) {
    return getIntermediateFunction(
      () => fallback,
      typeof keyHash === 'function'
        ? keyHash
        : !keyHash
        ? (_: any) => `${keyHash}`
        : (_: any) => `${this.keyIncrementer}`,
      options
    ).bind(this)();
  }
}

/**
 * Implements in-memory caching using decorators using Map<key:string, any>
 *
 * Can handle caching on methods with returns observables too(only one!).
 *
 * @param {Function} [fn] - function to generate unique hash(key),
 *  if not provided uses inline original method arguments.
 * @param {{ ttl?: number | false;  async?: boolean; log: boolean }}
 * [options={ ttl: 1800000, async: true, log: true }] - config options
 *
 *
 * ttl (DEFAULT: 30min): time-to-live
 *
 * async (DEFAULT: true): whether the original method is asynchronous (returns Observable)
 *
 * log (DEFAULT: false) print to console for each cache getter
 *
 * -
 * key structure - prefix : __cached_val_, suffix will be method's name & its argument combinations (uniqueness)
 *
 * USAGES:
 * import cache from 'cache-decorator';
 *
 * EXAMPLES:
 * @example
 *
 * @cache()
 * someMethod() {
 *  return this.http.get('/api/userroles');
 * }
 *
 * @example
 *
 * @cache(() => 'somekey')
 * someMethod() {
 *   return this.http.get('/api/countries');
 * }
 *
 * @example
 *
 * @cache({ ttl: 100, async: false })
 * somemethod() {
 *   return 'abc';
 * }
 *
 * @example
 *
 * @cache((params: any) => `key_${params}`, { log: true })
 * someMethod() {
 *   return this.http.get('/api/userroles');
 * }
 */
export function cache(fn?: hashFn, options?: CachizeOptions): MethodDecorator;
export function cache(options?: CachizeOptions): MethodDecorator;
export function cache(fn: hashFn | CachizeOptions | null = {}, options: CachizeOptions = {}): MethodDecorator {
  if (typeof fn !== 'function') {
    options = Object.assign({}, { ttl: 1800000, async: true, log: true }, fn);
    fn = null;
  } else {
    options = Object.assign({}, { ttl: 1800000, async: true, log: true }, options);
  }
  return (target: object, propertyKey: string, descriptor: TypedPropertyDescriptor<any>) => {
    if (descriptor.value != null) {
      descriptor.value = getIntermediateFunction(descriptor.value, fn, options);
    } else if (descriptor.get != null) {
      descriptor.get = getIntermediateFunction(descriptor.get, fn, options);
    } else {
      throw new Error('Only put a Cachize() decorator on a method or get accessor.');
    }
  };
}
export default cache;

// clear all cached data
export function clearAllCached<T extends { [key: string]: any }>(obj: T) {
  const keys = Object.getOwnPropertyNames(obj);
  const stub = '__cached_val_';

  for (const key of keys) {
    if (key !== undefined && key.startsWith(stub)) {
      delete obj[key];
    }
  }
}

// Returns if the key exists and has not expired.
function cacheGet(obj: any, key: string, hkey: string) {
  let cached: ICache | null = null;
  // Get or create map
  if (hkey && hkey.length > 0 && !obj.hasOwnProperty(key)) {
    Object.defineProperty(obj, key, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: new Map<any, ICache>(),
    });
  } else {
    cached = hkey.length > 0 ? obj[key].get(hkey) : obj[key];
  }
  if (cached && cached.expired < Date.now()) {
    if (hkey) {
      obj[key].delete(hkey);
    } else {
      delete obj[key];
    }
    return false;
  } else {
    return cached ? cached.data : false;
  }
}

// Sets the cache
function cacheSet(obj: any, key: string, hkey: string, data: any, options: any) {
  const memoized = obj[key];
  const cval = { data, expired: Date.now() + options.ttl };
  if (hkey) {
    memoized.set(hkey, cval);
  } else {
    Object.defineProperty(obj, key, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: cval,
    });
  }
  resolveInflights(obj, key, hkey, data, options);
}

// handle multiple observables
function resolveInflights(obj: any, key: string, hkey: string, data: any, options: CachizeOptions) {
  const fkey = `_inflightReq`;
  const fhkey = `${key}_${hkey || ''}`;
  if (!obj.hasOwnProperty(fkey)) {
    Object.defineProperty(obj, fkey, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: new Map<string, Subject<any>>(),
    });
  }
  if (!!data && obj[fkey].has(fhkey)) {
    const inFlight = obj[fkey].get(fhkey);
    const observersCount = inFlight.observers.length;
    if (observersCount) {
      if (options.log) {
        console.log(`%cNotifying ${inFlight.observers.length} flight subscribers for [${fhkey}]`, 'color: blue');
      }
      inFlight.next(data);
    }
    inFlight.complete();
    obj[fkey].delete(fhkey);
    return true;
  } else if (!data && obj[fkey].has(fhkey)) {
    return obj[fkey].get(fhkey);
  } else {
    obj[fkey].set(fhkey, new Subject());
    return false;
  }
}

// The function returned here gets called instead of originalMethod.
function getIntermediateFunction(
  originalMethod: () => any,
  hashFunction: hashFn | CachizeOptions | null,
  options: CachizeOptions
) {
  return function (this: any, ...args: any[]) {
    const propName = `__cached_val_${originalMethod.name || ''}`;
    let hashKey = '';
    if (args.length > 0) {
      hashKey = hashFunction
        ? (hashFunction as () => any).apply(this, args)
        : Object.keys(args[0])
            .map((f) => args[0][f])
            .join('_');
      hashKey = hashKey.replace(/\s+/g, '_');
    } else {
      hashKey = hashFunction ? (hashFunction as () => any).apply(this) : '';
    }
    const cached = cacheGet(this, propName, hashKey);
    if (cached) {
      if (options.log) {
        console.log(`%c Getting from cached [${propName}_${hashKey || ''}]`, 'color: green');
      }
      return options.async
        ? new Observable((observer) => {
            observer.next(cached);
            observer.complete();
          })
        : cached;
    }

    if (options.async) {
      const inflight = resolveInflights(this, propName, hashKey, undefined, options);
      return inflight
        ? inflight
        : originalMethod.apply(this, args).pipe(
            tap((data) => {
              cacheSet(this, propName, hashKey, data, options);
            })
          );
    } else {
      const newCache = originalMethod.apply(this, args);
      cacheSet(this, propName, hashKey, newCache, options);
      return newCache;
    }
  };
}
