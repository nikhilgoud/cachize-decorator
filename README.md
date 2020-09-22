# cachize-decorator & service

Implements in-memory caching using decorators & angular service using `Map<key:string, any>`.

- Gets the value from cache if the key is provided.
- If no value exists in cache, then check if the same call exists in flight, if so return the subject. If not create a new Subject inFlightObservable and return the source observable.
- Can also handle caching on methods with returns observables too(only one!).
- Cache Service is an observables based in-memory cache implementation
- Keeps track of in-flight observables and sets a default expiry, key for cached values  
  `key structure` - prefix : \__cachized_val_, suffix will be method's name & its argument combinations (uniqueness)

### options

- `ttl` (DEFAULT: 30min): time-to-live
- `async` (DEFAULT: true): whether the original method is asynchronous (returns Observable)
- `log` (DEFAULT: false) print to console for each cache getter

## USAGES:

### As Decorator

Decorator method params(both are optional)

- `fn` - function to generate unique hash(key), if not provided uses inline original method arguments.
- `options` - config options

```
import cachize from 'cachize-decorator';
```

EXAMPLES:

```
@cachize()
someMethod() {
 return this.http.get('/api/userroles');
}
```

```
@cachize(() => 'somekey')
someMethod() {
  return this.http.get('/api/countries');
}
```

```
@cachize({ ttl: 100, async: false })
somemethod() {
  return 'abc';
}
```

```
@cachize((params: any) => `key_${params}`, { log: true })
someMethod() {
  return this.http.get('/api/userroles');
}
```

### As Service

Service has `get` method with arguments
- `fallback`: Observable
- `keyHash`: Unique Key can be a Function or string
- `options`: config options(same as decorator)



`import CacheService from 'cache-decorator-service';`  
  ...  
`constructor(private readonly cacheService: CacheService){}`

EXAMPLES

```
return this.cacheService.get(this.http.get('/api/accounts'));  
  
return this.cacheService.get(this.http.get('/api/accounts'), 'somekey');  
return this.cacheService.get(this.http.get('/api/accounts'), 'somekey', { log: true });  
return this.cacheService.get(this.http.get('/api/accounts'), (params: any) => `key_${params}`,);  
return this.cacheService.get(this.http.get('/api/accounts'), (params: any) => `key_${params}`, { log: true });  
```

### References

https://gist.github.com/ashwin-sureshkumar/4e86617ab3757e075de160748e3ea132
https://github.com/vilic/memorize-decorator
