var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var PrismaClient = require('@prisma/client').PrismaClient;
var SYSTEM_TEMPLATE_PRESETS = require('../../apps/api/src/templates/system-presets').SYSTEM_TEMPLATE_PRESETS;
var prisma = new PrismaClient();
function reseedSystemTemplates() {
    return __awaiter(this, void 0, void 0, function () {
        var systemTemplates, _i, systemTemplates_1, t, _a, SYSTEM_TEMPLATE_PRESETS_1, preset;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    console.log('Deleting all existing system templates...');
                    return [4 /*yield*/, prisma.template.findMany({ where: { isSystem: true } })];
                case 1:
                    systemTemplates = _b.sent();
                    _i = 0, systemTemplates_1 = systemTemplates;
                    _b.label = 2;
                case 2:
                    if (!(_i < systemTemplates_1.length)) return [3 /*break*/, 6];
                    t = systemTemplates_1[_i];
                    return [4 /*yield*/, prisma.templateZone.deleteMany({ where: { templateId: t.id } })];
                case 3:
                    _b.sent();
                    return [4 /*yield*/, prisma.template.delete({ where: { id: t.id } })];
                case 4:
                    _b.sent();
                    console.log("Deleted ".concat(t.name, " (").concat(t.id, ")"));
                    _b.label = 5;
                case 5:
                    _i++;
                    return [3 /*break*/, 2];
                case 6:
                    console.log('Reseeding from SYSTEM_TEMPLATE_PRESETS...');
                    _a = 0, SYSTEM_TEMPLATE_PRESETS_1 = SYSTEM_TEMPLATE_PRESETS;
                    _b.label = 7;
                case 7:
                    if (!(_a < SYSTEM_TEMPLATE_PRESETS_1.length)) return [3 /*break*/, 10];
                    preset = SYSTEM_TEMPLATE_PRESETS_1[_a];
                    return [4 /*yield*/, prisma.template.create({
                            data: {
                                id: preset.id,
                                name: preset.name,
                                description: preset.description,
                                category: preset.category,
                                orientation: preset.orientation,
                                screenWidth: preset.screenWidth,
                                screenHeight: preset.screenHeight,
                                bgColor: preset.bgColor,
                                bgGradient: preset.bgGradient,
                                bgImage: preset.bgImage,
                                isSystem: true,
                                status: 'ACTIVE',
                                tenantId: null,
                                zones: {
                                    create: preset.zones.map(function (z, i) {
                                        var _a, _b;
                                        return ({
                                            name: z.name,
                                            widgetType: z.widgetType,
                                            x: z.x,
                                            y: z.y,
                                            width: z.width,
                                            height: z.height,
                                            zIndex: (_a = z.zIndex) !== null && _a !== void 0 ? _a : 0,
                                            sortOrder: (_b = z.sortOrder) !== null && _b !== void 0 ? _b : i,
                                            defaultConfig: z.defaultConfig ? JSON.stringify(z.defaultConfig) : null,
                                        });
                                    }),
                                },
                            },
                        })];
                case 8:
                    _b.sent();
                    console.log("Created ".concat(preset.name, " (").concat(preset.id, ")"));
                    _b.label = 9;
                case 9:
                    _a++;
                    return [3 /*break*/, 7];
                case 10:
                    console.log('Done!');
                    return [2 /*return*/];
            }
        });
    });
}
reseedSystemTemplates()
    .catch(console.error)
    .finally(function () { return prisma.$disconnect(); });
