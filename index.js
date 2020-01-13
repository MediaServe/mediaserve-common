const fetch = require('node-fetch');
const abort = require('abort-controller');
const bignumber = require("bignumber.js");
const mysql = require('mysql');
const uuid = require('uuid/v5');
const async = require('async');
const fs = require('fs');
const util = require('util');
const cors = require('cors');

const express = {
	"express": require('express'),
	"session": require('express-session'),
	"upload": require('express-fileupload'),
	"handlebars": require('express-handlebars'),
	"openapi": require('express-openapi'),
	"validator": require('express-openapi-validator').OpenApiValidator
};

const color = {
	"red": '\x1b[31m',
	"green": '\x1b[32m',
	"bright": {
		"red": '\x1b[91m',
		"green": '\x1b[92m'
	},
	"dim": '\x1b[2m',
	"reset": '\x1b[0m'
};

const validate = (value, pattern) => {
	/**
	 * Validate an object against an object template
	 * @param {Object} value An object to validate
	 * @param {Object} pattern An empty object template to use for validation
	 * @return {Boolean}
	*/

	const check = (value, pattern) => {
		return pattern && value && typeof pattern === 'object' && typeof value === 'object' ? ( Object.keys(pattern).length <= Object.keys(value).length && Object.keys(pattern).every(key => check(value[key], pattern[key])) ) : (typeof pattern === typeof value);
	};

	if (check(value, pattern)) { return true; };
	throw new Error("Value does not match pattern");
};

class service {
	constructor (config) {
		this.config = {
			"timeout": 30000
		};

		Object.assign(this.config, config);

		this.timers = [];

		this.UUID = () => {
			/**
			 * Returns a unique ID for the nl.mediaserve.common namespace
			 * @return {String}
			*/

			try {
				let namespace = uuid('nl.mediaserve.common', uuid.DNS);
				return uuid(JSON.stringify(process.hrtime()), namespace);
			} catch (error) {
				return false;
			};
		};

		this.Timer = class Timer {
			constructor () {
				let timestamp = process.hrtime();
				this.start = () => { timestamp = process.hrtime(); };
				this.reset = () => { timestamp = process.hrtime(); };
				this.stop = () => {
					timestamp = process.hrtime(timestamp);
					return timestamp[0]+(timestamp[1]/1000000000);
				};
			};
		};

		this.trim = (message) => {
			/**
			 * Trims any spaces in the beginning and end of the message
			 * @param {String} message The message to be trimmed
			 * @return {String}
			*/

			return (message).replace(/^\s+/g, "").replace(/\s+$/g, "");
		};

		this.untrim = (message) => {
			/**
			 * Trims the message and adds exactly one space at the beginning and end of the message
			 * @param {String} message The message to be untrimmed
			 * @return {String}
			*/

			return (' '+this.trim(message)+' ');
		};

		this.is = {
			null: (value) => {
				return value === null;
			},
			undefined: (value) => {
				return typeof value === 'undefined';
			},
			string: (value) => {
				return typeof value === 'string' || value instanceof String;
			},
			array: (value) => {
				return Array.isArray(value);
			},
			object: (value) => {
				return value && typeof value === 'object' && value.constructor === Object;
			},
			boolean: (value) => {
				return typeof value === 'boolean';
			},
			error: (value) => {
				return value instanceof Error && typeof value.message !== 'undefined';
			},
			json: (value) => {
				try {
					JSON.parse(value);
				} catch (error) {
					return false;
				};
				return true;
			}
		};

		this.log = (message, type) => {
			/**
			 * Print a log message on the terminal
			 * @param {Array} message An array of messages to print on the terminal
			 * @param {String} type Type of log message: debug or error (optional)
			 * @return {Boolean}
			*/

			let red = function (message) { return (color.red+message+color.reset); };
			let green = function (message) { return (color.green+message+color.reset); };

			let bright = {
				red: function (message) { return (color.bright.red+message+color.reset); },
				green: function (message) { return (color.bright.green+message+color.reset); }
			};

			let dim = function (message) { return (color.dim+message+color.reset); };

			if (!this.is.object(message) && !this.is.array(message)) {
				if (this.is.error(message)) { type = "error"; };
				message = [ message ];
			};

			let date = new Date().toISOString();
			let ID = (dim('[')+process.pid+dim(']'));

			switch (type) {
				case "error":
					if (!this.is.object(message)) { message = red(message.join(' ').replace(/^Error: /g, '')); }
					console.error(bright.red(date), ID, bright.red('ERROR'), message, color.reset);
					break;
				case "debug":
					if (!this.is.object(message)) { message = dim(message.join(' ')); };
					console.debug(bright.green(date), ID, message, color.reset);
					break;
				default:
					if (!this.is.object(message)) { message = green(message.join(' ')); };
					console.log(bright.green(date), ID, message, color.reset);
			};
		};

		this.fetch = async (address, method, body) => {
			/**
			 * Request JSON data from a remote address
			 * @param {String} address The remote HTTP address to sent the request
			 * @param {String} method The request method (POST, GET)
			 * @param {String} body The JSON request body
			 * @return {String}
			*/

			if (!this.is.string(method)) { throw new Error("Invalid parameter: expected string"); };
			if (!this.is.json(body)) { throw new Error("Invalid parameter: expected object"); };

			try {
				let controller = new abort.AbortController;
				let timeout = (this.timers.push(setTimeout (() => { controller.abort(); }, this.config.timeout))-1);
				let response = await fetch(address, { signal: controller.signal, method: method, body: body, headers: { 'Content-Type': 'application/json' } });
				clearTimeout(this.timers[timeout]);
				let data = await response.json();
				return data;
			} catch (error) {
				throw error;
			};
		};

		this.time = () => {
			let now = new Date();
			return now.toISOString();
		};

		this.validate = validate;
		this.fs = fs;
		this.bignumber = bignumber;
		this.db = {
			sql: mysql
		};

		this.exit = (message) => {
			/**
			 * Stops the service and exits the process
			 * @param {String} message The error message to show before shutdown
			 * @return {Boolean}
			*/

			if (!this.is.error(message)) { message = new Error(message); };
			this.log(message);
			for (let index = 0; index < this.timers.length; index++) { clearTimeout(this.timers[index]); };
			return process.exit(1);
		};
	};
};

class server {
	constructor (config) {
		this.config = {
			"port": 3080,
			"address": "127.0.0.1",
			"secret": "22009b5d-c745-49eb-b364-fbce41be4da7",
			"name": "MediaServe",
			"api": { "enable": false }
		};

		Object.assign(this.config, config);

		let app = express.express();
		express.socket = require('express-ws')(app);

		let helpers = {
			equals: function(a, b, options) {
				if (a === b) { return options.fn(this); };
				return options.inverse(this);
			}
		};

		app.listen(this.config.port, this.config.address);
		app.engine('.html', express.handlebars({ layout: false, extname: '.html', helpers: helpers }));
		app.set('view engine', '.html');
		app.use(express.express.urlencoded({ limit: '16mb', extended: true }));
		app.use(express.express.json({ limit: '16mb', extended: true }));
		app.use(express.upload());
		app.use(express.session({
			secret: this.config.secret,
			name: this.config.name,
			proxy: true,
			resave: true,
			saveUninitialized: true
		}));

		if (this.config.cors.enable) {
			app.use(cors());
		};

		if (this.config.api.enable) {
			new express.validator({
				apiSpec: this.config.api.specifications,
				securityHandlers: {
					apiKey: (request, scopes, schema) => {
						if (request.headers) {
							let key = request.headers[schema.name.toLowerCase()];
							for (let namespace of this.config.api.domains) {
								for (let user of namespace.users) {
									if (user.key == key && user.active) {
										return true;
									};
								};
							};
						};
						throw { status: 403, message: 'Forbidden' }
					}
				},
				validateResponses: false
			}).install(app);

			express.openapi.initialize({
				app,
				apiDoc: this.config.api.specifications,
				operations: this.config.api.operations,
				errorMiddleware: (error, request, response, next) => {
					let status = 400;
					let message = "Bad Request";
					if (error && error.errors && Array.isArray(error.errors)) {
						message = error.errors[0].message;
					};
					if (error && error.status) {
						status = error.status;
					};
					let result = {
						code: status,
						message: message
					};
					response.status(status);
					response.send(result);
				}
			});
		};

		this.start = async (service, request) => {
			let timer = new service.Timer(), uuid = service.UUID();
			service.log([uuid,"new request from",JSON.stringify(request.headers["x-forwarded-for"]),"URL:",JSON.stringify(request.originalUrl)], "debug");
			return { "timer": timer, "uuid": uuid, "data": { "uuid": uuid }, "session": request.session };
		};

		this.finalize = async (service, timer, uuid, render) => {
			let time = timer.stop();
			service.log([uuid,"request completed in",time,"seconds"], "debug");
			render();
		};

		this.sockets = (address) => {
			return express.socket.getWss(address);
		};

		this.app = app;
	};
};

class database {
	constructor (config) {
		this.config = {
			"host": "127.0.0.1",
			"port": "3306",
			"user": "mediaserve",
			"password": "mediaserve",
			"database": "mediaserve",
			"timeout": 120000
		};

		Object.assign(this.config, config);

		this.connect = () => {
			let pool = mysql.createPool({
				connectionLimit: 32,
				queueLimit: 1024,
				supportBigNumbers: true,
				multipleStatements: true,
				host: this.config.host,
				port: this.config.port,
				user: this.config.user,
				password: this.config.password,
				database: this.config.database,
			});

			pool.getConnection((error, connection) => {
				if (error) { throw new Error("Unable to connect to database server: " + error); };
				connection.release();
			});

			let query = util.promisify(pool.query).bind(pool);
			return { "pool": pool, "query": query };
		};

		this.execute = async (connection, query) => {
			try {
				let array = [], results = await connection.query({ "sql": query, "timeout": this.config.timeout });
				for (let index in results) { array.push(results[index]); };
				return array;
			} catch (error) {
				throw new Error("Unable to execute database query: " + JSON.stringify({ "sql": query, "error": error }));
			};
		};
	};
};

module.exports = {
	Service: service,
	Server: server,
	Database: database
};
