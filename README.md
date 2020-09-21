# cachize-decorator


 Implements in-memory caching using decorators using `Map<key:string, any>` 
 Can also handle caching on methods with returns observables too(only one!).
 

 ### options
 * `ttl` (DEFAULT: 30min): time-to-live
 * `async` (DEFAULT: true): whether the original method is asynchronous (returns Observable)
 * `log` (DEFAULT: false) print to console for each cache getter
 
 - key structure - prefix : __cachized_val_, suffix will be method's name & its argument combinations (uniqueness)
 
 USAGES:

Decorator method params(both are optional)  
  * `fn` - function to generate unique hash(key), if not provided uses inline original method arguments.  
  * `options` - config options  

  
   
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
  
 ### References 
 https://gist.github.com/ashwin-sureshkumar/4e86617ab3757e075de160748e3ea132  
 https://github.com/vilic/memorize-decorator
