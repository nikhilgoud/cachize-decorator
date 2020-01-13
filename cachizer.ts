import { Observable } from 'rxjs/internal/Observable';
import { Subject } from 'rxjs/internal/Subject';
import { tap } from 'rxjs/operators';

interface ICache {
  expired: number;
  data: any;
}
// References 
// https://gist.github.com/ashwin-sureshkumar/4e86617ab3757e075de160748e3ea132
// https://github.com/vilic/memorize-decorator
// API caching decorator
export function Cachize(hashFunction?: (...args: any[]) => any, options = { ttl: 1800000 }): MethodDecorator {
  return (target: object, propertyKey: string, descriptor: TypedPropertyDescriptor<any>) => {

    if (descriptor.value != null) {
      descriptor.value = getNewFunction(descriptor.value, hashFunction, options);
    } else if (descriptor.get != null) {
      descriptor.get = getNewFunction(descriptor.get, hashFunction, options);
    } else {
      throw new Error('Only put a Cachize() decorator on a method or get accessor.');
    }
  };
}
// clear all
export function clearAllCached<T extends { [key: string]: any }>(obj: T) {
  const keys = Object.getOwnPropertyNames(obj);
  const stub = '__cachified_val_';

  for (const key of keys) {
    if (key !== undefined && key.startsWith(stub)) {
      delete obj[key];
    }
  }
}

// Returns if the key exists and has not expired.
export function cacheGet(obj: any, key: string, hkey: string, options: any) {
  let cached: ICache;
  // Get or create map 
  if (hkey.length > 0 && !obj.hasOwnProperty(key)) {
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
export function cacheSet(obj, key, hkey, data, options) {
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
export function resolveInflights(obj, key, hkey, data, options) {
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

let counter = 0;
function getNewFunction(originalMethod: () => void, hashFunction?: (...args: any[]) => any, options?: any) {
  const identifier = ++counter;

  // The function returned here gets called instead of originalMethod.
  return function (...args: any[]) {
    const propName = `__cachified_val_${identifier}`;

    let hashKey: string;
    if (args.length > 0) {
      hashKey = hashFunction ? hashFunction.apply(this, args) : Object.keys(args[0]).map((f) => args[0][f]).join('_');
      hashKey = hashKey.replace(/\s+/g, '_');
    }
    const cached = cacheGet(this, propName, hashKey, options);
    if (cached) {
      console.log(`%c Getting from cached [${propName}_${hashKey || ''}]`, 'color: green');
      return new Observable((observer) => {
        observer.next(cached);
        observer.complete();
      });
    }

    const inflight = resolveInflights(this, propName, hashKey, undefined, options);

    return inflight ? inflight : originalMethod.apply(this, args).pipe(tap((data) => {
      cacheSet(this, propName, hashKey, data, options);
    }));

  };
}
