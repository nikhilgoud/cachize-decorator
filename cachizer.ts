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
}
/**
 * Implements in-memory caching using decorators
 * @param fn : function to generate unique hash(key), if not provided uses inline original method's arguments
 * @param options: { ttl?: number | false;  async?: boolean; }
 * ttl: time-to-live (DEFAULT: 30min)
 * async (DEFAULT: true): whether the original method is asynchronous(returns Promise or Observable)
 *
 * USAGES:
 * import cachize from 'cachize-decorator';
 *
 * @cachize({
 *   // Deletes cache after 100 milliseconds.
 *   ttl: 100,
 * })
 * somemethod() {
 *   return 'abc';
 * }
 *
 * @cachize()
 * asyncMethod() {
 *   return this.http.get('/api/userroles');
 * }
 *
 * @cachize()
 * someMethod() {
 *   return this.http.get('/api/countries');
 * }
 */
export function cachize<T extends () => void>(fn: T, options?: CachizeOptions | undefined): T;
export function cachize(options?: CachizeOptions | undefined): MethodDecorator;
export function cachize(
  fn?: (() => void) | CachizeOptions,
  options: CachizeOptions | undefined = { ttl: 1800000, async: true }
): any {
  if (typeof fn !== 'function') {
    options = fn;
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
  resolveInflights(obj, key, hkey, data);
}

// handle multiple observables
function resolveInflights(obj: any, key: string, hkey: string, data: any) {
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
      console.log(`%cNotifying ${inFlight.observers.length} flight subscribers for [${fhkey}]`, 'color: blue');
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
  originalMethod: () => void,
  hashFunction?: (() => void) | CachizeOptions,
  options: CachizeOptions = {}
) {
  return function (this: any, ...args: any[]) {
    const propName = `__cachized_val_${originalMethod.name}`;
    let hashKey = '';
    if (args.length > 0) {
      hashKey = hashFunction
        ? (hashFunction as () => void).apply(this, args)
        : Object.keys(args[0])
            .map((f) => args[0][f])
            .join('_');
      hashKey = hashKey.replace(/\s+/g, '_');
    }
    const cached = cacheGet(this, propName, hashKey);
    if (cached) {
      console.log(`%c Getting from cached [${propName}_${hashKey || ''}]`, 'color: green');
      return options.async
        ? new Observable((observer) => {
            observer.next(cached);
            observer.complete();
          })
        : cached;
    }

    if (options.async) {
      const inflight = resolveInflights(this, propName, hashKey, undefined);
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
// https://github.com/vilic/memorize-decorator
