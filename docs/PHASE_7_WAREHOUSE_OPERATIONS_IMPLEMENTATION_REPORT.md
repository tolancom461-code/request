# Phase 7 — Warehouse Operations Implementation Report

**النطاق المنفذ:** Phase 7 فقط. أُضيفت عمليات المستودع للطلبات التي وصلت مسبقًا وبشكل تلقائي من Phase 6 إلى `sent_to_warehouse`. لا يشمل التنفيذ مخزونًا أو شراءً أو استلامًا أو تسعيرًا أو مركز إشعارات Phase 8 أو واجهة تدقيق عامة أو تقارير Phase 9 أو أعمال إصدار/Go-Live.

## الملخص التنفيذي

أضيف namespace خادمي محمي للمستودع مع queue وتفاصيل وتجميعات مبنية على request snapshots، ثم سلسلة انتقالات مقيدة وذرية: `sent_to_warehouse → preparing → ready → dispatched → completed`. يتطلب كل endpoint صلاحية `warehouse.process` والجلسة وCSRF لمسارات التغيير، ويطبّق نطاق الفرع المحفوظ خادميًا. يجمع التنفيذ القفل `FOR UPDATE` و`rowVersion` والتحقق من الحالة والأسطر الفعالة وسجل الحالة والتدقيق وتحديث النسخة في Prisma transaction واحدة.

تمت إضافة واجهة Material UI ضمن هوية Verdant Operations، مع Queue وتصفية وبحث وتجميع وتفاصيل وحوارات تأكيد وحالات تحميل/فارغ/خطأ/تعارض/offline، وبالعربية RTL والإنجليزية LTR والأردية RTL. كما أضيف `cache: "no-store"` لقراءات Warehouse في الواجهة بعد أن كشف التحقق المرئي احتمال عرض حالة lifecycle قديمة من cache المتصفح؛ أصبح العرض يعيد قراءة الحالة و`rowVersion` الخادميين.

| بند التحقق | النتيجة الفعلية |
|---|---:|
| اختبار Phase 7 التكامل المركزي | 4/4 PASS |
| اختبار عقد واجهة Phase 7 | 4/4 PASS |
| الانحدار المستهدف | 47/47 PASS عبر 8 ملفات |
| الانحدار الكامل | 84/84 PASS عبر 22 ملفًا |
| Prisma validate / generate | PASS / PASS |
| TypeScript | PASS |
| بناء الإنتاج وPWA | PASS؛ `generateSW` و64 مدخل precache |
| Prisma schema / migrations | لم تتغير |

## التنفيذ الخادمي

أُضيفت `WarehouseOperationsService` و`WarehouseOperationsController` وسُجلتا في `AppModule`. المسارات الفعلية هي `GET /api/v1/warehouse/requests` و`GET /api/v1/warehouse/requests/groups` و`GET /api/v1/warehouse/requests/:requestId` وأوامر POST المنفصلة `start-preparation` و`mark-ready` و`dispatch` و`complete`.

يدعم queue pagination وsearch وstatus allowlist والفلاتر المقيدة بالخادم للفرع والمورد snapshot والصنف وتواريخ `warehouseAvailableAt`/التقديم/التحديث وsort allowlist. الوضع الافتراضي يعرض الحالات القابلة للتنفيذ فقط؛ لا تظهر المسودات أو المعلقة أو المعادة أو المرفوضة. التجميعات Request/Branch/Supplier/Item تقرأ الأسطر الفعالة فقط، وتجمع `baseQuantitySnapshot` بـ`Decimal`، وتحتفظ بالسياق الأصلي للكمية والوحدة والمورد snapshot. لا يعيد هذا المسار حل primary supplier أو conversion factor الحاليين.

كل انتقال يستخدم قفل الطلب والتحقق من `expectedRowVersion` ونطاق الفرع ثم تحققًا من وجود سطر فعال صحيح موجب. بعد update مشروط واحد للحالة والنسخة، يكتب transaction نفسه `RequestStatusHistory` بالمستخدم الفعلي و`AuditLog` بالفعل المناسب. لا توجد endpoint عامة لتعديل الحالة، ولا transactions جذرية متداخلة. الطلب المكتمل يرفض لاحقًا كل mutations الاعتيادية لأن `completed` ليس بداية انتقال مسموحًا.

## التفويض والنطاق والأمان

يفرض المتحكم `PermissionsGuard` و`@Permissions("warehouse.process")` على كل مسارات Warehouse. تؤكد الخدمة نطاق الفرع من `UserBranchScope` الخادمي في list/group/detail/transition، مع تجاوز System Admin القائم فقط. لا يثق التنفيذ بادعاء role أو branch من المتصفح. تحفظ طبقة الحماية العامة CSRF لمسارات POST، وأثبتت اختبارات التكامل رفض غير الموثق وBranch Employee وBranch Manager ومستخدم المستودع خارج النطاق وCSRF الناقص/الخاطئ.

## الواجهة والتشغيل

أضيف مدخل **Warehouse queue** في التنقل عند وجود metadata آمن لصلاحية `warehouse.process` فقط، بينما يبقى التفويض الخادمي هو السلطة النهائية. تعرض التفاصيل اللقطات المجمدة والأسطر المستبعدة كسجل قراءة فقط، وسجل handoff والانتقالات المحلية. لا توجد عناصر UI للمخزون أو السحب من المورد أو الاستلام أو تعديل الكميات/الوحدات/المورد.

التقطت 13 لقطة فعلية بحجم 893×768، تشمل Queue عربي RTL، تجميع المورد والصنف، تفاصيل `sent_to_warehouse`، حوار بدء التحضير، حالات preparing/ready/dispatched/completed والقراءة فقط، التعارض القديم مع زر التحديث، offline، الإنجليزية LTR، والأردية RTL. استخدمت جلسات fixtures مؤقتة ثم نُظفت حساباتها وطلباتها وبياناتها بالكامل. لا تتضمن اللقطات شاشات دخول أو أسرار أو DSN.

## الاختبارات والأدلة

يغطي `phase7-warehouse-operations.integration.test.ts` التفويض والنطاق وCSRF وPhase 6 handoff والتجميع من اللقطات والاستبعاد والمنع الذري للقفزات والانتقالات الكاملة والتاريخ والتدقيق و`rowVersion` والتزامن والrollback والسلوك الطرفي. يغطي اختبار الواجهة الموروث المتاح navigation والمسارات وCSRF وdispatch والحالات والترجمات. بنية UI test الحالية في المشروع هي source-contract وليست DOM interaction؛ هذا **NON-BLOCKING / REMEDIATION** موروث، وقد عوضته أدلة متصفح فعلية متعددة اللغات وحالات تشغيل فعلية، ولا توجد نتيجة وظيفية خاطئة مكتشفة.

## Prisma والحدود والقيود المعروفة

بصمة `prisma/schema.prisma` هي `5c7eb330310f18b74f05e269dedf94f18deb355fc6744ae7ebad4c045224cfdb`، ولا يوجد diff للمخطط أو للمهاجرات. لا أضيف dispatch/completed timestamps للراحة؛ `RequestStatusHistory.occurredAt` هو الدليل الزمني السلطوي كما يفرض العقد. لم تُنشأ batches أو ledgers أو stock quantities أو purchase orders أو dispatch/receiving tables.

التحذيرات غير الحاجبة الوحيدة من build كانت Rollup chunk-size advisory وbaseline-browser-mapping freshness advisory؛ لم تفشل البوابات ولم تُعالَج كتحسين أداء خارج النطاق. لا توجد عيوب BLOCKING معروفة. لم يبدأ Phase 8 أو أي مرحلة لاحقة.

## الملفات التي تغيرت

راجِع `phase7/changed_files.md` للقائمة الدقيقة، و`phase7/package_manifest.md` لمحتوى الحزمة والاستبعادات الآمنة.

WAREHOUSE QUEUE IMPLEMENTED: YES

WAREHOUSE PROCESS SERVER AUTHORIZATION VERIFIED: YES

WAREHOUSE BRANCH SCOPE ENFORCED SERVER SIDE: YES

WAREHOUSE GROUPING BY BRANCH VERIFIED: YES

WAREHOUSE GROUPING BY ITEM VERIFIED: YES

WAREHOUSE GROUPING BY SUPPLIER SNAPSHOT VERIFIED: YES

SENT TO WAREHOUSE TO PREPARING VERIFIED: YES

PREPARING TO READY VERIFIED: YES

READY TO DISPATCHED VERIFIED: YES

DISPATCHED TO COMPLETED VERIFIED: YES

WAREHOUSE TRANSITIONS ARE ATOMIC AND AUDITED: YES

WAREHOUSE CONCURRENCY SAFETY VERIFIED: YES

COMPLETED REQUEST IS TERMINAL FOR PHASE 7: YES

PHASE 6 AUTOMATIC WAREHOUSE HANDOFF REGRESSION PASSED: YES

ARABIC RTL WAREHOUSE UI VERIFIED: YES

ENGLISH LTR WAREHOUSE UI VERIFIED: YES

URDU RTL WAREHOUSE UI VERIFIED: YES

FULL REGRESSION PASSED: YES

PHASE 7 FOCUSED TESTS PASSED: YES

PRISMA SCHEMA CHANGED: NO

PRISMA MIGRATIONS CHANGED: NO

UNEXPLAINED DATABASE DRIFT: NO

PHASE 8 STARTED: NO

BLOCKING DEFECTS REMAIN: NO

PHASE 7 READY FOR INDEPENDENT REVIEW: YES
