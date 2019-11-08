declare module 'conventional-commits-parser' {
  import { Transform } from "stream";

  function parser(options: Options): Transform
  parser.sync = (message: string, options: Options) => any

  export = parser
}
