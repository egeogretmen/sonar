const makeClient = require('../client')
// const chalk = require('chalk')
// const pretty = require('pretty-bytes')
// const table = require('text-table')
// const date = require('date-fns')
const collect = require('stream-collector')
const yargs = require('yargs')

exports.command = 'db'
exports.describe = 'database put, get, query'
exports.handler = () => yargs.showHelp()
exports.builder = function (yargs) {
  yargs
    .command({
      command: 'get <id>',
      describe: 'get records',
      builder: {
        schema: {
          alias: 's',
          describe: 'schema'
        }
      },
      handler: get
    })
    .command({
      command: 'put [id]',
      describe: 'put record from stdin',
      builder: {
        schema: {
          alias: 's',
          describe: 'schema',
          required: true
        },
        data: {
          alias: 'd',
          describe: 'data (if not passed STDIN is used)'
        }
      },
      handler: put
    })
    .command({
      command: 'query [name] [args]',
      describe: 'query',
      handler: query
    })
    .command({
      command: 'put-schema [name]',
      describe: 'put schema from stdin',
      handler: putSchema
    })
    .command({
      command: 'get-schema [name]',
      describe: 'get schemas',
      handler: getSchema
    })
    .command({
      command: 'list-schemas',
      describe: 'list schemas',
      handler: listSchemas
    })
    .command({
      command: 'delete-schema [name]',
      describe: 'delete schema from island',
      handler: deleteSchema
    })
    .help()
}

async function get (argv) {
  const client = makeClient(argv)
  const { id, schema } = argv
  const records = await client.get({ id, schema })
  console.log(JSON.stringify(records))
}

async function put (argv) {
  const client = makeClient(argv)
  let { schema, id, data } = argv
  if (!data) {
    data = await collectJson(process.stdin)
  } else {
    data = JSON.parse(data)
  }
  const record = { schema, id, value: data }
  const result = await client.put(record)
  console.log(result.id)
}

async function query (argv) {
  const client = makeClient(argv)
  let { name, args } = argv
  if (args) args = JSON.parse(args)
  const results = await client.query(name, args)
  console.log(results)
}

async function putSchema (argv) {
  const client = makeClient(argv)
  const { name } = argv
  const value = await collectJson(process.stdin)
  const result = await client.putSchema(name, value)
  console.log(result)
}

async function getSchema (argv) {
  const client = makeClient(argv)
  const { name } = argv
  const result = await client.getSchema(name)
  console.log(result)
}

async function listSchemas (argv) {
  const client = makeClient(argv)
  const schemas = await client.getSchemas()
  if (!schemas) return console.error('No schemas')
  console.log(Object.keys(schemas).join('\n'))
}

async function deleteSchema (argv) {
  const client = makeClient(argv)
  const { name } = argv
  const result = await client.deleteSchema(name)
  console.log(result)
}

function collectJson () {
  return new Promise((resolve, reject) => {
    collect(process.stdin, async (err, buf) => {
      if (err) return console.error(err)
      try {
        const value = JSON.parse(buf.toString())
        resolve(value)
      } catch (e) {
        console.error(e.message)
        reject(e)
      }
    })
  })
}
