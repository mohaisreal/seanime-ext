// Shared factories are available in the installed Seanime runtime, but are
// missing from the older bundled plugin typings reused by this repository.
declare namespace $shared {
    function define<T>(name: string, factory: () => T): void;
    function use<T>(name: string): T;
}
