"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const { PrismaClient } = require('@prisma/client');
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new adapter_pg_1.PrismaPg(pool);
const globalForPrisma = globalThis;
exports.prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== 'production')
    globalForPrisma.prisma = exports.prisma;
exports.default = exports.prisma;
//# sourceMappingURL=prisma.js.map