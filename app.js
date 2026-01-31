// ==================== 配置管理 ====================
// API基础URL：自动检测本地或云端环境
const API_BASE_URL = window.location.origin + '/api/feishu';

let config = {
    appId: '',
    appSecret: '',
    sheetToken: '',
    // 表ID（需要在飞书中创建后获取）
    purchaseTableId: '',
    formulaTableId: '',
    salesTableId: ''
};

// 表ID映射（字段名 -> 飞书字段ID）
let fieldMapping = {
    purchase: {},
    formula: {},
    sales: {}
};

// 本地数据缓存
let purchaseData = [];
let formulaData = [];
let salesData = [];
let materialPrices = {}; // 原料价格缓存 {原料名: 单价}

// 加载配置
function loadConfig() {
    const saved = localStorage.getItem('feishuConfig');
    if (saved) {
        config = { ...config, ...JSON.parse(saved) };
        document.getElementById('appId').value = config.appId || '';
        document.getElementById('appSecret').value = config.appSecret || '';
        document.getElementById('sheetToken').value = config.sheetToken || '';
    }
}

// 保存配置
function saveConfig() {
    config.appId = document.getElementById('appId').value.trim();
    config.appSecret = document.getElementById('appSecret').value.trim();
    config.sheetToken = document.getElementById('sheetToken').value.trim();

    if (!config.appId || !config.appSecret || !config.sheetToken) {
        showToast('请填写完整的配置信息', 'error');
        return;
    }

    localStorage.setItem('feishuConfig', JSON.stringify(config));
    showToast('配置已保存', 'success');
    toggleConfig();

    // 尝试初始化表格
    initTables();
}

// 切换配置面板
function toggleConfig() {
    const panel = document.getElementById('configPanel');
    panel.classList.toggle('hidden');
    panel.classList.toggle('show');
}

// ==================== 飞书API调用 ====================
let accessToken = '';
let tokenExpireTime = 0;

// 获取访问令牌
async function getAccessToken() {
    if (accessToken && Date.now() < tokenExpireTime) {
        return accessToken;
    }

    try {
        const response = await fetch(API_BASE_URL + '/open-apis/auth/v3/tenant_access_token/internal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app_id: config.appId,
                app_secret: config.appSecret
            })
        });

        const data = await response.json();
        if (data.code === 0) {
            accessToken = data.tenant_access_token;
            tokenExpireTime = Date.now() + (data.expire - 60) * 1000; // 提前1分钟过期
            return accessToken;
        } else {
            throw new Error(data.msg || '获取访问令牌失败');
        }
    } catch (error) {
        console.error('获取访问令牌失败:', error);
        showToast('获取访问令牌失败: ' + error.message, 'error');
        throw error;
    }
}

// 通用API请求
async function feishuAPI(url, method = 'GET', body = null) {
    const token = await getAccessToken();

    // 将完整的飞书API URL转换为代理 URL
    // 例如: https://open.feishu.cn/open-apis/bitable/v1/apps/xxx
    // 转换为: /api/feishu/open-apis/bitable/v1/apps/xxx
    const proxyUrl = url.replace('https://open.feishu.cn', API_BASE_URL);

    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    const options = { method, headers };
    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(proxyUrl, options);
    const data = await response.json();

    if (data.code !== 0) {
        throw new Error(data.msg || 'API请求失败');
    }

    return data;
}

// 初始化表格
async function initTables() {
    try {
        showLoading(true);

        // 验证配置
        if (!config.appId || !config.appSecret || !config.sheetToken) {
            throw new Error('配置信息不完整，请检查 App ID、App Secret 和 Sheet Token');
        }

        // 先测试获取访问令牌
        let token;
        try {
            token = await getAccessToken();
        } catch (tokenError) {
            if (tokenError.message.includes('99991663') || tokenError.message.includes('invalid')) {
                throw new Error('App ID 或 App Secret 不正确，请检查配置');
            }
            throw new Error('获取访问令牌失败: ' + tokenError.message);
        }

        // 获取或创建表格
        let tables;
        try {
            tables = await feishuAPI(
                `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.sheetToken}/tables`
            );
        } catch (apiError) {
            if (apiError.message.includes('99991400') || apiError.message.includes('not found')) {
                throw new Error('Sheet Token 不正确或无权限访问该多维表格');
            }
            if (apiError.message.includes('99991668') || apiError.message.includes('permission')) {
                throw new Error('无权限访问该多维表格，请检查应用权限配置');
            }
            throw new Error('获取表格列表失败: ' + apiError.message);
        }

        if (tables.data && tables.data.items) {
            // 查找或创建三个数据表
            let purchaseTbl = tables.data.items.find(t => t.name === '原料采购');
            let formulaTbl = tables.data.items.find(t => t.name === '产品配方');
            let salesTbl = tables.data.items.find(t => t.name === '商品销售');

            if (!purchaseTbl) {
                purchaseTbl = await createTable('原料采购', getPurchaseFields());
            }
            if (!formulaTbl) {
                formulaTbl = await createTable('产品配方', getFormulaFields());
            }
            if (!salesTbl) {
                salesTbl = await createTable('商品销售', getSalesFields());
            }

            config.purchaseTableId = purchaseTbl.table_id;
            config.formulaTableId = formulaTbl.table_id;
            config.salesTableId = salesTbl.table_id;

            // 保存更新后的配置（包含tableId）
            localStorage.setItem('feishuConfig', JSON.stringify(config));

            // 获取字段映射
            await getFieldMappings();

            // 加载数据
            await loadData();

            showToast('初始化成功', 'success');
        }
    } catch (error) {
        console.error('初始化表格失败:', error);
        showToast('初始化失败: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// 创建数据表
async function createTable(name, fields) {
    const result = await feishuAPI(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.sheetToken}/tables`,
        'POST',
        { table: { name, default_view_name: '网格视图', fields } }
    );
    return result.data.table;
}

// 获取字段映射
async function getFieldMappings() {
    const tables = [
        { name: 'purchase', id: config.purchaseTableId },
        { name: 'formula', id: config.formulaTableId },
        { name: 'sales', id: config.salesTableId }
    ];

    for (const tbl of tables) {
        const result = await feishuAPI(
            `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.sheetToken}/tables/${tbl.id}/fields`
        );

        if (result.data && result.data.items) {
            fieldMapping[tbl.name] = {};
            result.data.items.forEach(field => {
                fieldMapping[tbl.name][field.field_name] = field.id;
            });
        }
    }
}

// 字段定义
function getPurchaseFields() {
    return [
        { field_name: '原料名称', type: 1, description: '文本' },
        { field_name: '规格', type: 1, description: '文本' },
        { field_name: '采购数量', type: 2, description: '数字' },
        { field_name: '单位', type: 1, description: '文本' },
        { field_name: '采购总价', type: 2, description: '数字', property: { formatter: { pattern: '0.00' } } },
        { field_name: '采购单价', type: 2, description: '数字', property: { formatter: { pattern: '0.00' } } },
        { field_name: '采购日期', type: 5, description: '日期' },
        { field_name: '供应商', type: 1, description: '文本' }
    ];
}

function getFormulaFields() {
    return [
        { field_name: '产品名称', type: 1, description: '文本' },
        { field_name: '制作数量', type: 2, description: '数字' },
        { field_name: '原料组成', type: 1, description: 'JSON文本' },
        { field_name: '包装成本', type: 2, description: '数字', property: { formatter: { pattern: '0.00' } } },
        { field_name: '水电成本', type: 2, description: '数字', property: { formatter: { pattern: '0.00' } } },
        { field_name: '单位成本', type: 2, description: '数字', property: { formatter: { pattern: '0.00' } } }
    ];
}

function getSalesFields() {
    return [
        { field_name: '销售日期', type: 5, description: '日期' },
        { field_name: '产品名称', type: 1, description: '文本' },
        { field_name: '销售数量', type: 2, description: '数字' },
        { field_name: '销售总金额', type: 2, description: '数字', property: { formatter: { pattern: '0.00' } } },
        { field_name: '销售单价', type: 2, description: '数字', property: { formatter: { pattern: '0.00' } } },
        { field_name: '单位成本', type: 2, description: '数字', property: { formatter: { pattern: '0.00' } } },
        { field_name: '成本总额', type: 2, description: '数字', property: { formatter: { pattern: '0.00' } } },
        { field_name: '利润', type: 2, description: '数字', property: { formatter: { pattern: '0.00' } } }
    ];
}

// ==================== 数据操作 ====================
// 加载所有数据
async function loadData() {
    try {
        showLoading(true);

        const [purchase, formula, sales] = await Promise.all([
            getTableRecords(config.purchaseTableId),
            getTableRecords(config.formulaTableId),
            getTableRecords(config.salesTableId)
        ]);

        purchaseData = purchase || [];
        formulaData = formula || [];
        salesData = sales || [];

        // 更新原料价格缓存
        updateMaterialPrices();

        // 渲染表格
        renderPurchaseTable();
        renderFormulaTable();
        renderSalesTable();
        updateProductSelect();

    } catch (error) {
        console.error('加载数据失败:', error);
        showToast('加载数据失败: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// 获取表格记录
async function getTableRecords(tableId) {
    const result = await feishuAPI(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.sheetToken}/tables/${tableId}/records?view_id=`
    );

    if (result.data && result.data.items) {
        return result.data.items.map(record => ({
            id: record.record_id,
            fields: record.fields
        }));
    }
    return [];
}

// 添加记录
async function addRecord(tableId, fields) {
    // 将字段名称转换为字段ID
    const convertedFields = convertFieldNamesToIds(tableId, fields);

    const result = await feishuAPI(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.sheetToken}/tables/${tableId}/records`,
        'POST',
        { fields: convertedFields }
    );
    return result.data.record;
}

// 更新记录
async function updateRecord(tableId, recordId, fields) {
    // 将字段名称转换为字段ID
    const convertedFields = convertFieldNamesToIds(tableId, fields);

    const result = await feishuAPI(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.sheetToken}/tables/${tableId}/records/${recordId}`,
        'PUT',
        { fields: convertedFields }
    );
    return result.data.record;
}

// 将字段名称转换为字段ID
function convertFieldNamesToIds(tableId, fields) {
    let mapping;
    if (tableId === config.purchaseTableId) {
        mapping = fieldMapping.purchase;
    } else if (tableId === config.formulaTableId) {
        mapping = fieldMapping.formula;
    } else if (tableId === config.salesTableId) {
        mapping = fieldMapping.sales;
    } else {
        return fields;
    }

    const converted = {};
    for (const [name, value] of Object.entries(fields)) {
        const fieldId = mapping[name];
        if (fieldId) {
            converted[fieldId] = value;
        } else {
            // 如果找不到字段ID，使用原字段名（兼容新创建的表格）
            converted[name] = value;
        }
    }
    return converted;
}

// 删除记录
async function deleteRecord(tableId, recordId) {
    await feishuAPI(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.sheetToken}/tables/${tableId}/records/${recordId}`,
        'DELETE'
    );
}

// 刷新数据
async function refreshData() {
    if (!config.purchaseTableId) {
        showToast('请先配置飞书API', 'error');
        return;
    }
    await loadData();
    showToast('数据已刷新', 'success');
}

// ==================== 原料采购管理 ====================
function showPurchaseForm(record = null) {
    document.getElementById('purchaseForm').classList.remove('hidden');

    if (record) {
        // 编辑模式
        document.getElementById('purchaseRecordId').value = record.id;
        document.getElementById('purchaseName').value = record.fields['原料名称'] || '';
        document.getElementById('purchaseSpec').value = record.fields['规格'] || '';
        document.getElementById('purchaseQuantity').value = record.fields['采购数量'] || '';
        document.getElementById('purchaseUnit').value = record.fields['单位'] || '';
        document.getElementById('purchaseTotalPrice').value = record.fields['采购总价'] || '';
        document.getElementById('purchaseUnitPrice').value = record.fields['采购单价'] || '';
        document.getElementById('purchaseDate').value = timestampToDateString(record.fields['采购日期']);
        document.getElementById('purchaseSupplier').value = record.fields['供应商'] || '';
    } else {
        // 新增模式
        document.getElementById('purchaseRecordId').value = '';
        document.getElementById('purchaseName').value = '';
        document.getElementById('purchaseSpec').value = '';
        document.getElementById('purchaseQuantity').value = '';
        document.getElementById('purchaseUnit').value = '';
        document.getElementById('purchaseTotalPrice').value = '';
        document.getElementById('purchaseUnitPrice').value = '';
        document.getElementById('purchaseDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('purchaseSupplier').value = '';
    }

    // 绑定自动计算单价
    document.getElementById('purchaseTotalPrice').oninput = calculatePurchaseUnitPrice;
    document.getElementById('purchaseQuantity').oninput = calculatePurchaseUnitPrice;
}

function hidePurchaseForm() {
    document.getElementById('purchaseForm').classList.add('hidden');
}

function calculatePurchaseUnitPrice() {
    const total = parseFloat(document.getElementById('purchaseTotalPrice').value) || 0;
    const quantity = parseFloat(document.getElementById('purchaseQuantity').value) || 0;

    if (quantity > 0) {
        const unitPrice = (total / quantity).toFixed(2);
        document.getElementById('purchaseUnitPrice').value = unitPrice;
    } else {
        document.getElementById('purchaseUnitPrice').value = '';
    }
}

async function savePurchase() {
    const name = document.getElementById('purchaseName').value.trim();
    const quantity = parseFloat(document.getElementById('purchaseQuantity').value);
    const totalPrice = parseFloat(document.getElementById('purchaseTotalPrice').value);
    const date = document.getElementById('purchaseDate').value;

    if (!name || !quantity || !totalPrice || !date) {
        showToast('请填写必填项', 'error');
        return;
    }

    const unitPrice = (totalPrice / quantity).toFixed(2);

    // 将日期字符串转换为毫秒时间戳
    const dateTimestamp = date ? new Date(date).getTime() : 0;

    const fields = {
        '原料名称': name,
        '规格': document.getElementById('purchaseSpec').value.trim(),
        '采购数量': quantity,
        '单位': document.getElementById('purchaseUnit').value.trim(),
        '采购总价': totalPrice,
        '采购单价': parseFloat(unitPrice),
        '采购日期': dateTimestamp,
        '供应商': document.getElementById('purchaseSupplier').value.trim()
    };

    try {
        showLoading(true);
        const recordId = document.getElementById('purchaseRecordId').value;

        if (recordId) {
            await updateRecord(config.purchaseTableId, recordId, fields);
        } else {
            await addRecord(config.purchaseTableId, fields);
        }

        await loadData();
        hidePurchaseForm();
        showToast('保存成功', 'success');
    } catch (error) {
        showToast('保存失败: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function deletePurchase(recordId) {
    if (!confirm('确定要删除这条记录吗？')) return;

    try {
        showLoading(true);
        await deleteRecord(config.purchaseTableId, recordId);
        await loadData();
        showToast('删除成功', 'success');
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

function renderPurchaseTable() {
    const tbody = document.getElementById('purchaseTableBody');
    tbody.innerHTML = purchaseData.map(record => `
        <tr>
            <td>${record.fields['原料名称'] || ''}</td>
            <td>${record.fields['规格'] || '-'}</td>
            <td>${record.fields['采购数量'] || 0}</td>
            <td>${record.fields['单位'] || '-'}</td>
            <td>${(record.fields['采购单价'] || 0).toFixed(2)}</td>
            <td>${(record.fields['采购总价'] || 0).toFixed(2)}</td>
            <td>${timestampToDateString(record.fields['采购日期']) || '-'}</td>
            <td>${record.fields['供应商'] || '-'}</td>
            <td>
                <button class="btn btn-sm btn-secondary" onclick='showPurchaseForm(${JSON.stringify(record).replace(/'/g, "&#39;")})'>编辑</button>
                <button class="btn btn-sm btn-danger" onclick="deletePurchase('${record.id}')">删除</button>
            </td>
        </tr>
    `).join('');
}

// ==================== 产品配方管理 ====================
let materialRowCount = 0;

function showFormulaForm(record = null) {
    document.getElementById('formulaForm').classList.remove('hidden');
    document.getElementById('formulaMaterials').innerHTML = '';

    if (record) {
        document.getElementById('formulaRecordId').value = record.id;
        document.getElementById('formulaProductName').value = record.fields['产品名称'] || '';
        document.getElementById('formulaQuantity').value = record.fields['制作数量'] || 1;
        document.getElementById('formulaPackageCost').value = record.fields['包装成本'] || 0;
        document.getElementById('formulaUtilityCost').value = record.fields['水电成本'] || 0;

        const materials = record.fields['原料组成'];
        if (materials) {
            try {
                const materialList = typeof materials === 'string' ? JSON.parse(materials) : materials;
                materialList.forEach(m => addMaterialRow(m));
            } catch (e) {
                console.error('解析原料组成失败', e);
            }
        }

        calculateFormulaCost();
    } else {
        document.getElementById('formulaRecordId').value = '';
        document.getElementById('formulaProductName').value = '';
        document.getElementById('formulaQuantity').value = 1;
        document.getElementById('formulaPackageCost').value = 0;
        document.getElementById('formulaUtilityCost').value = 0;
        addMaterialRow();
    }

    // 绑定计算事件
    document.getElementById('formulaQuantity').oninput = calculateFormulaCost;
    document.getElementById('formulaPackageCost').oninput = calculateFormulaCost;
    document.getElementById('formulaUtilityCost').oninput = calculateFormulaCost;
}

function hideFormulaForm() {
    document.getElementById('formulaForm').classList.add('hidden');
}

function addMaterialRow(data = null) {
    const container = document.getElementById('formulaMaterials');
    const row = document.createElement('div');
    row.className = 'material-row';
    row.id = `material-${materialRowCount}`;

    // 获取原料列表
    const materialOptions = getMaterialOptions();

    row.innerHTML = `
        <div class="form-group">
            <label>原料</label>
            <select class="material-name" onchange="onMaterialChange(this)">
                <option value="">请选择</option>
                ${materialOptions}
            </select>
        </div>
        <div class="form-group">
            <label>用量</label>
            <input type="number" class="material-amount" step="0.01" value="${data?.amount || ''}" oninput="calculateFormulaCost()">
        </div>
        <div class="form-group">
            <label>单位</label>
            <input type="text" class="material-unit" value="${data?.unit || ''}" placeholder="g/ml">
        </div>
        <div class="form-group">
            <label>单价(元)</label>
            <input type="text" class="material-price" value="${data?.price || ''}" readonly>
        </div>
        <button class="btn btn-sm btn-danger" onclick="removeMaterialRow(${materialRowCount})">删除</button>
    `;

    container.appendChild(row);

    // 设置选中的原料
    if (data && data.name) {
        row.querySelector('.material-name').value = data.name;
        updateMaterialPrice(row.querySelector('.material-name'));
    }

    materialRowCount++;
}

function onMaterialChange(selectElement) {
    updateMaterialPrice(selectElement);
    calculateFormulaCost();
}

function removeMaterialRow(id) {
    const row = document.getElementById(`material-${id}`);
    if (row) {
        row.remove();
        calculateFormulaCost();
    }
}

function getMaterialOptions() {
    return Object.keys(materialPrices).map(name =>
        `<option value="${name}">${name}</option>`
    ).join('');
}

function updateMaterialPrices() {
    materialPrices = {};
    purchaseData.forEach(record => {
        const name = record.fields['原料名称'];
        if (name) {
            materialPrices[name] = {
                price: record.fields['采购单价'] || 0,
                unit: record.fields['单位'] || ''
            };
        }
    });
}

function updateMaterialPrice(selectElement) {
    const materialName = selectElement.value;
    const row = selectElement.closest('.material-row');
    const priceInput = row.querySelector('.material-price');

    if (materialName && materialPrices[materialName]) {
        priceInput.value = materialPrices[materialName].price.toFixed(2);
        // 更新单位
        const unitInput = row.querySelector('.material-unit');
        if (!unitInput.value) {
            unitInput.value = materialPrices[materialName].unit;
        }
    } else {
        priceInput.value = '';
    }
}

function calculateFormulaCost() {
    const rows = document.querySelectorAll('.material-row');
    let materialCost = 0;

    rows.forEach(row => {
        const price = parseFloat(row.querySelector('.material-price').value) || 0;
        const amount = parseFloat(row.querySelector('.material-amount').value) || 0;
        materialCost += price * amount;
    });

    const packageCost = parseFloat(document.getElementById('formulaPackageCost').value) || 0;
    const utilityCost = parseFloat(document.getElementById('formulaUtilityCost').value) || 0;
    const quantity = parseFloat(document.getElementById('formulaQuantity').value) || 1;

    const totalCost = materialCost + packageCost + utilityCost;
    const unitCost = quantity > 0 ? (totalCost / quantity).toFixed(2) : 0;

    document.getElementById('formulaUnitCost').value = unitCost;

    return { materialCost, packageCost, utilityCost, totalCost, unitCost };
}

async function saveFormula() {
    const productName = document.getElementById('formulaProductName').value.trim();
    const quantity = parseFloat(document.getElementById('formulaQuantity').value);

    if (!productName || !quantity) {
        showToast('请填写必填项', 'error');
        return;
    }

    // 收集原料信息
    const materials = [];
    document.querySelectorAll('.material-row').forEach(row => {
        const name = row.querySelector('.material-name').value;
        const amount = parseFloat(row.querySelector('.material-amount').value) || 0;
        const unit = row.querySelector('.material-unit').value.trim();
        const price = parseFloat(row.querySelector('.material-price').value) || 0;

        if (name && amount > 0) {
            materials.push({ name, amount, unit, price });
        }
    });

    const cost = calculateFormulaCost();

    const fields = {
        '产品名称': productName,
        '制作数量': quantity,
        '原料组成': JSON.stringify(materials),
        '包装成本': parseFloat(document.getElementById('formulaPackageCost').value) || 0,
        '水电成本': parseFloat(document.getElementById('formulaUtilityCost').value) || 0,
        '单位成本': parseFloat(cost.unitCost)
    };

    try {
        showLoading(true);
        const recordId = document.getElementById('formulaRecordId').value;

        if (recordId) {
            await updateRecord(config.formulaTableId, recordId, fields);
        } else {
            await addRecord(config.formulaTableId, fields);
        }

        await loadData();
        hideFormulaForm();
        showToast('保存成功', 'success');
    } catch (error) {
        showToast('保存失败: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function deleteFormula(recordId) {
    if (!confirm('确定要删除这条记录吗？')) return;

    try {
        showLoading(true);
        await deleteRecord(config.formulaTableId, recordId);
        await loadData();
        showToast('删除成功', 'success');
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

function renderFormulaTable() {
    const tbody = document.getElementById('formulaTableBody');
    tbody.innerHTML = formulaData.map(record => {
        const materials = record.fields['原料组成'];
        let materialText = '';

        if (materials) {
            try {
                const materialList = typeof materials === 'string' ? JSON.parse(materials) : materials;
                materialText = materialList.map(m => `${m.name} ${m.amount}${m.unit}`).join(', ');
            } catch (e) {
                materialText = materials;
            }
        }

        const otherCost = ((record.fields['包装成本'] || 0) + (record.fields['水电成本'] || 0)).toFixed(2);

        return `
            <tr>
                <td>${record.fields['产品名称'] || ''}</td>
                <td>${record.fields['制作数量'] || 0}</td>
                <td>${materialText || '-'}</td>
                <td>${otherCost}</td>
                <td>${(record.fields['单位成本'] || 0).toFixed(2)}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" onclick='showFormulaForm(${JSON.stringify(record).replace(/'/g, "&#39;")})'>编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteFormula('${record.id}')">删除</button>
                </td>
            </tr>
        `;
    }).join('');
}

// ==================== 商品销售管理 ====================
function showSalesForm(record = null) {
    document.getElementById('salesForm').classList.remove('hidden');

    if (record) {
        document.getElementById('salesRecordId').value = record.id;
        document.getElementById('salesDate').value = timestampToDateString(record.fields['销售日期']);
        document.getElementById('salesProductName').value = record.fields['产品名称'] || '';
        document.getElementById('salesQuantity').value = record.fields['销售数量'] || '';
        document.getElementById('salesTotalAmount').value = record.fields['销售总金额'] || '';
        document.getElementById('salesUnitPrice').value = (record.fields['销售单价'] || 0).toFixed(2);
        document.getElementById('salesUnitCost').value = (record.fields['单位成本'] || 0).toFixed(2);
        document.getElementById('salesTotalCost').value = (record.fields['成本总额'] || 0).toFixed(2);
        document.getElementById('salesProfit').value = (record.fields['利润'] || 0).toFixed(2);
    } else {
        document.getElementById('salesRecordId').value = '';
        document.getElementById('salesDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('salesProductName').value = '';
        document.getElementById('salesQuantity').value = '';
        document.getElementById('salesTotalAmount').value = '';
        document.getElementById('salesUnitPrice').value = '';
        document.getElementById('salesUnitCost').value = '';
        document.getElementById('salesTotalCost').value = '';
        document.getElementById('salesProfit').value = '';
    }

    // 绑定计算事件
    document.getElementById('salesQuantity').oninput = calculateSalesPrice;
    document.getElementById('salesTotalAmount').oninput = calculateSalesPrice;
    document.getElementById('salesProductName').onchange = updateSalesCost;
}

function hideSalesForm() {
    document.getElementById('salesForm').classList.add('hidden');
}

function updateProductSelect() {
    const select = document.getElementById('salesProductName');
    const products = [...new Set(formulaData.map(r => r.fields['产品名称']))];

    select.innerHTML = '<option value="">请选择</option>' +
        products.map(p => `<option value="${p}">${p}</option>`).join('');
}

function updateSalesCost() {
    const productName = document.getElementById('salesProductName').value;
    const formula = formulaData.find(r => r.fields['产品名称'] === productName);

    if (formula) {
        const unitCost = formula.fields['单位成本'] || 0;
        document.getElementById('salesUnitCost').value = unitCost.toFixed(2);
        calculateSalesPrice();
    } else {
        document.getElementById('salesUnitCost').value = '';
    }
}

function calculateSalesPrice() {
    const quantity = parseFloat(document.getElementById('salesQuantity').value) || 0;
    const totalAmount = parseFloat(document.getElementById('salesTotalAmount').value) || 0;
    const unitCost = parseFloat(document.getElementById('salesUnitCost').value) || 0;

    const unitPrice = quantity > 0 ? (totalAmount / quantity).toFixed(2) : 0;
    const totalCost = (unitCost * quantity).toFixed(2);
    const profit = (totalAmount - parseFloat(totalCost)).toFixed(2);

    document.getElementById('salesUnitPrice').value = unitPrice;
    document.getElementById('salesTotalCost').value = totalCost;
    document.getElementById('salesProfit').value = profit;

    // 利润着色
    const profitInput = document.getElementById('salesProfit');
    if (parseFloat(profit) >= 0) {
        profitInput.style.color = '#28a745';
    } else {
        profitInput.style.color = '#dc3545';
    }
}

async function saveSales() {
    const date = document.getElementById('salesDate').value;
    const productName = document.getElementById('salesProductName').value.trim();
    const quantity = parseFloat(document.getElementById('salesQuantity').value);
    const totalAmount = parseFloat(document.getElementById('salesTotalAmount').value);

    if (!date || !productName || !quantity || !totalAmount) {
        showToast('请填写必填项', 'error');
        return;
    }

    const unitPrice = parseFloat(document.getElementById('salesUnitPrice').value) || 0;
    const unitCost = parseFloat(document.getElementById('salesUnitCost').value) || 0;
    const totalCost = parseFloat(document.getElementById('salesTotalCost').value) || 0;
    const profit = parseFloat(document.getElementById('salesProfit').value) || 0;

    // 将日期字符串转换为毫秒时间戳
    const dateTimestamp = date ? new Date(date).getTime() : 0;

    const fields = {
        '销售日期': dateTimestamp,
        '产品名称': productName,
        '销售数量': quantity,
        '销售总金额': totalAmount,
        '销售单价': unitPrice,
        '单位成本': unitCost,
        '成本总额': totalCost,
        '利润': profit
    };

    try {
        showLoading(true);
        const recordId = document.getElementById('salesRecordId').value;

        if (recordId) {
            await updateRecord(config.salesTableId, recordId, fields);
        } else {
            await addRecord(config.salesTableId, fields);
        }

        await loadData();
        hideSalesForm();
        showToast('保存成功', 'success');
    } catch (error) {
        showToast('保存失败: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function deleteSales(recordId) {
    if (!confirm('确定要删除这条记录吗？')) return;

    try {
        showLoading(true);
        await deleteRecord(config.salesTableId, recordId);
        await loadData();
        showToast('删除成功', 'success');
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

function renderSalesTable() {
    const tbody = document.getElementById('salesTableBody');
    // 按日期降序排序
    const sortedSales = [...salesData].sort((a, b) => {
        const dateA = a.fields['销售日期'] || 0;
        const dateB = b.fields['销售日期'] || 0;
        return dateB - dateA;
    });

    tbody.innerHTML = sortedSales.map(record => {
        const profit = record.fields['利润'] || 0;
        const profitClass = profit >= 0 ? 'profit' : 'profit-negative';

        return `
            <tr>
                <td>${timestampToDateString(record.fields['销售日期']) || '-'}</td>
                <td>${record.fields['产品名称'] || ''}</td>
                <td>${record.fields['销售数量'] || 0}</td>
                <td>${(record.fields['销售单价'] || 0).toFixed(2)}</td>
                <td>${(record.fields['销售总金额'] || 0).toFixed(2)}</td>
                <td>${(record.fields['成本总额'] || 0).toFixed(2)}</td>
                <td class="${profitClass}">${profit.toFixed(2)}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" onclick='showSalesForm(${JSON.stringify(record).replace(/'/g, "&#39;")})'>编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteSales('${record.id}')">删除</button>
                </td>
            </tr>
        `;
    }).join('');
}

// ==================== 利润统计 ====================
function updateStats() {
    const range = document.getElementById('statsRange').value;
    const customRange = document.getElementById('customDateRange');

    if (range === 'custom') {
        customRange.classList.remove('hidden');
    } else {
        customRange.classList.add('hidden');
    }

    const now = new Date();
    let startDate, endDate = now;

    switch (range) {
        case 'today':
            startDate = new Date(now);
            startDate.setHours(0, 0, 0, 0);
            break;
        case 'week':
            startDate = new Date(now);
            startDate.setDate(now.getDate() - now.getDay());
            startDate.setHours(0, 0, 0, 0);
            break;
        case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
        case 'custom':
            startDate = new Date(document.getElementById('statsStartDate').value);
            endDate = new Date(document.getElementById('statsEndDate').value);
            endDate.setHours(23, 59, 59, 999);
            break;
    }

    // 过滤数据
    const filteredSales = salesData.filter(record => {
        const saleDate = new Date(record.fields['销售日期']);
        return saleDate >= startDate && saleDate <= endDate;
    });

    // 计算统计数据
    let totalSales = 0;
    let totalCost = 0;
    let totalProfit = 0;
    const productStats = {};

    filteredSales.forEach(record => {
        const salesAmount = record.fields['销售总金额'] || 0;
        const costAmount = record.fields['成本总额'] || 0;
        const profit = record.fields['利润'] || 0;
        const productName = record.fields['产品名称'] || '未知产品';
        const quantity = record.fields['销售数量'] || 0;

        totalSales += salesAmount;
        totalCost += costAmount;
        totalProfit += profit;

        if (!productStats[productName]) {
            productStats[productName] = {
                quantity: 0,
                sales: 0,
                cost: 0,
                profit: 0
            };
        }
        productStats[productName].quantity += quantity;
        productStats[productName].sales += salesAmount;
        productStats[productName].cost += costAmount;
        productStats[productName].profit += profit;
    });

    // 更新统计卡片
    document.getElementById('totalSales').textContent = totalSales.toFixed(2);
    document.getElementById('totalCost').textContent = totalCost.toFixed(2);
    document.getElementById('totalProfit').textContent = totalProfit.toFixed(2);

    const profitRate = totalSales > 0 ? ((totalProfit / totalSales) * 100).toFixed(2) : 0;
    document.getElementById('profitRate').textContent = profitRate;

    // 更新统计表格
    const statsBody = document.getElementById('statsTableBody');
    statsBody.innerHTML = Object.entries(productStats).map(([name, stats]) => {
        const rate = stats.sales > 0 ? ((stats.profit / stats.sales) * 100).toFixed(2) : 0;
        const profitClass = stats.profit >= 0 ? 'profit' : 'profit-negative';

        return `
            <tr>
                <td>${name}</td>
                <td>${stats.quantity}</td>
                <td>${stats.sales.toFixed(2)}</td>
                <td>${stats.cost.toFixed(2)}</td>
                <td class="${profitClass}">${stats.profit.toFixed(2)}</td>
                <td class="${profitClass}">${rate}%</td>
            </tr>
        `;
    }).join('');
}

// 监听自定义日期变化
document.getElementById('statsStartDate').addEventListener('change', updateStats);
document.getElementById('statsEndDate').addEventListener('change', updateStats);

// ==================== UI辅助函数 ====================
// 将时间戳转换为 YYYY-MM-DD 格式
function timestampToDateString(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toISOString().split('T')[0];
}

function showTab(tabName) {
    // 隐藏所有标签页
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // 显示选中的标签页
    document.getElementById(tabName + 'Tab').classList.add('active');
    event.target.classList.add('active');

    // 如果是统计页，更新统计数据
    if (tabName === 'stats') {
        updateStats();
    }
}

function showLoading(show) {
    const loading = document.getElementById('loading');
    if (show) {
        loading.classList.remove('hidden');
    } else {
        loading.classList.add('hidden');
    }
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');

    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', function() {
    loadConfig();

    // 检查是否已配置
    if (config.appId && config.appSecret && config.sheetToken) {
        initTables();
    } else {
        // 自动打开配置面板
        toggleConfig();
    }
});
