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
 * key structure - prefix : __cachized_val_, suffix will be method's name & its argument combinations (uniqueness)
 *
 * USAGES:
 * import cachize from 'cachize-decorator';
 *
 * EXAMPLES:
 * @example
 *
 * @cachize()
 * someMethod() {
 *  return this.http.get('/api/userroles');
 * }
 *
 * @example
 *
 * @cachize(() => 'somekey')
 * someMethod() {
 *   return this.http.get('/api/countries');
 * }
 *
 * @example
 *
 * @cachize({ ttl: 100, async: false })
 * somemethod() {
 *   return 'abc';
 * }
 *
 * @example
 *
 * @cachize((params: any) => `key_${params}`, { log: true })
 * someMethod() {
 *   return this.http.get('/api/userroles');
 * }
 */
export function cachize(fn?: (_: any) => any, options?: CachizeOptions): MethodDecorator;
export function cachize(options?: CachizeOptions): MethodDecorator;
export function cachize(
  fn: ((_: any) => any) | CachizeOptions | null = {},
  options: CachizeOptions = {}
): MethodDecorator {
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
export default cachize;

// clear all cached data
export function clearAllCached<T extends { [key: string]: any }>(obj: T) {
  const keys = Object.getOwnPropertyNames(obj);
  const stub = '__cachized_val_';

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
  hashFunction: ((_: any) => any) | CachizeOptions | null,
  options: CachizeOptions
) {
  return function (this: any, ...args: any[]) {
    const propName = `__cachized_val_${originalMethod.name}`;
    let hashKey = '';
    if (args.length > 0) {
      hashKey = hashFunction
        ? (hashFunction as () => any).apply(this, args)
        : Object.keys(args[0])
            .map((f) => args[0][f])
            .join('_');
      hashKey = hashKey.replace(/\s+/g, '_');
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

// References
// https://gist.github.com/ashwin-sureshkumar/4e86617ab3757e075de160748e3ea132
