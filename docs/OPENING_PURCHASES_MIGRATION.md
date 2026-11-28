# تطبيق ترحيل سجل الشراء الافتتاحي يدويًا

1. افتح قاعدة `REQUEST` في محرر SQL وتأكد من ظهور جدول المشتريات الفعلية.

   ```sql
   USE `REQUEST`;
   SELECT DATABASE() AS current_database;
   SHOW TABLES LIKE 'purchase_receipts';
   ```

   إذا لم يظهر الجدول، نفّذ [ترحيل المشتريات السابق](PURCHASE_WORKFLOW_MIGRATION.md) أولًا.

2. نفّذ [ملف SQL للسجل الافتتاحي](../prisma/migrations/20261124160000_opening_purchases/migration.sql) كاملًا بالترتيب. ينشئ الملف جدول السجل الافتتاحي وعلاقاته بالأصناف والموردين ووحدات الصنف والمستخدمين.

3. تحقّق من إنشاء الجدول وعلاقاته.

   ```sql
   SHOW CREATE TABLE `opening_purchases`;
   ```

4. بعد نجاح كل العبارات، سجّل الترحيل في Prisma من مجلد المشروع باستخدام `DATABASE_URL` للقاعدة نفسها.

   ```powershell
   node .\node_modules\prisma\build\index.js migrate resolve --applied 20261124160000_opening_purchases --schema prisma/schema.prisma
   node .\node_modules\prisma\build\index.js migrate status --schema prisma/schema.prisma
   ```

## إدخال السجل بعد النشر

1. افتح **العناصر**، واختر الصنف في خطوة **ربط الموردين**. في **سجل مشتريات الصنف** اضغط **إدخال سجل افتتاحي**.
2. أدخل العمليات واحدة تلو الأخرى، أو استخدم **لصق من Excel** للصنف المختار. انسخ الصفوف بترتيب الأعمدة التالي. رمز المورد، رمز الوحدة، تاريخ الشراء بصيغة `YYYY-MM-DD`، الكمية، تكلفة الوحدة بالريال قبل الضريبة، ومرجع الفاتورة إن وُجد. ابدأ بصف البيانات الأول بعد عناوين الأعمدة.
3. بعد الحفظ، تظهر العمليات بمصدر **سجل افتتاحي**، وتدخل مباشرة في مقارنة آخر شراء والمتوسط المرجّح.
