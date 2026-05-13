/** Ambient declarations for sql.js browser bundle used in the MBTiles worker. */
declare module 'sql.js/dist/sql-wasm-browser.js' {
  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
  }): Promise<import('sql.js').SqlJsStatic>;
}
