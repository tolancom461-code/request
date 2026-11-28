# تطبيق ترحيل المشتريات يدويًا

نفّذ الترحيل قبل نشر إصدار روم الذي يتضمن تجهيز الشراء.

1. افتح قاعدة `REQUEST` في محرر SQL، وتأكد من اسم القاعدة ووجود عمود المورد الافتراضي.

   ```sql
   USE `REQUEST`;
   SELECT DATABASE() AS current_database;
   SHOW COLUMNS FROM items LIKE 'default_supplier_id';
   ```

2. نفّذ ملف [migration.sql](../prisma/migrations/20261124153000_purchase_workflow/migration.sql) كاملًا من أعلى لأسفل. ينشئ جداول الموردين المرتبطين وخطط الشراء وكشوف الموردين وسجل المشتريات. ويضيف المورد الافتراضي الحالي لكل صنف إلى روابط الموردين ويمنح صلاحيات الشراء لدوري مدير النظام ومدير المستودع.

3. تأكد من اكتمال ربط الموردين الحاليين ومنح الصلاحيات. يظهر العدد الأول صفرًا، وتظهر ثلاث صلاحيات لكل من الدورين الموجودين في القاعدة.

   ```sql
   SELECT COUNT(*) AS missing_supplier_links
   FROM items AS item_row
   LEFT JOIN item_suppliers AS item_supplier
     ON item_supplier.item_id = item_row.id
    AND item_supplier.supplier_id = item_row.default_supplier_id
   WHERE item_row.default_supplier_id IS NOT NULL
     AND item_supplier.item_id IS NULL;

   SELECT role_row.code AS role_code, COUNT(*) AS purchasing_permissions
   FROM roles AS role_row
   JOIN role_permissions AS role_permission ON role_permission.role_id = role_row.id
   JOIN permissions AS permission_row ON permission_row.id = role_permission.permission_id
   WHERE role_row.code IN ('system_admin', 'warehouse_manager')
     AND permission_row.code IN ('purchase.prepare', 'purchase.issue', 'purchase.record')
   GROUP BY role_row.code;
   ```

4. بعد نجاح كل عبارات SQL، نفّذ الأمرين من مجلد المشروع باستخدام إعداد `DATABASE_URL` الخاص بالقاعدة نفسها. يسجل الأمر الأول الترحيل في سجل Prisma ويؤكد الثاني حالة السجل.

   ```powershell
   node .\node_modules\prisma\build\index.js migrate resolve --applied 20261124153000_purchase_workflow --schema prisma/schema.prisma
   node .\node_modules\prisma\build\index.js migrate status --schema prisma/schema.prisma
   ```

إذا توقف محرر SQL عند خطأ، يُحتمل أن يكون TiDB نفّذ العبارات السابقة. احتفظ باسم العبارة ورسالة الخطأ وافحص ما طُبّق قبل المتابعة. سجّل الترحيل في Prisma فقط بعد اكتمال التنفيذ.
