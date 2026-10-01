# Phase 9 — Reports & Dashboards Implementation Report

## النطاق والنتيجة

نُفذت **Phase 9 فقط** بوصفها طبقة تقارير تشغيلية خادمية للقراءة فقط. تشمل اللوحة التشغيلية وتقارير الطلبات والفروع والأصناف ولقطات الموردين والحالة/الدورة وأداء الاعتمادات ومعالجة المستودع، إضافة إلى تصدير CSV مقيد بالصلاحيات والنطاق. لم يُضف مخزون أو شراء أو تكلفة أو مبيعات أو تنبؤات أو أي عمل من Phase 10.

| البند | النتيجة الفعلية |
|---|---|
| مصدر الوقائع التاريخية | `RequestItem` snapshot و`RequestStatusHistory` فقط بحسب نوع التقرير |
| الصلاحيات | `reports.view` لكل قراءة، و`reports.export` مع `reports.view` للتصدير |
| النطاق | مفروض خادميًا عبر `UserBranchScope`؛ System Admin فقط يملك التجاوز العالمي |
| التصدير | CSV بترميز UTF-8 BOM وحد 5,000 صف وتحـييد قيم الصيغ |
| قاعدة البيانات | لا تعديل في `prisma/schema.prisma` أو `prisma/migrations` |
| Phase 10 | لم تبدأ |

## التقارير ومؤشرات الأداء

تعيد لوحة `/api/v1/reports/dashboard` أعداد الحالات الحالية والكمية الأساسية النشطة ومعدلات الإكمال/الإرجاع/الرفض. المقام في النسب هو عدد الطلبات ذات أول تقديم ضمن الفترة المختارة. الإكمال يستند إلى الحالة الحالية `completed`، بينما الإرجاع والرفض يحسبان الطلبات المميزة التي لديها انتقال تاريخي واحد على الأقل إلى الحالة المقابلة.

تُحسب دورات الاعتماد والمستودع والدورة الكاملة بالدقائق من التسلسل المرتب لـ`RequestStatusHistory`: أول `pending_approval` إلى أول `approved`، وأول `sent_to_warehouse` إلى أول `completed`، وأول `pending_approval` إلى أول `completed`. تُهمل السلاسل غير المكتملة أو غير الصالحة ولا تُخترع مدة بديلة.

| السطح | الأساس السلطوي | المخرجات الرئيسة |
|---|---|---|
| Dashboard | الطلبات المقدمة + السجل | KPI والحالات الحالية والمعدلات والمدد |
| Requests | `RequestRecord` + الأسطر + آخر حدث | صفوف قابلة للصفحات والفلاتر والبحث |
| Branches | الطلبات ضمن النطاق | عدد الطلبات والحالات والكمية الأساسية والمدة |
| Items | أسطر snapshot النشطة | الكمية الأساسية ووحدات الطلب وتفصيل الفروع |
| Supplier snapshots | حقول المورد المجمدة في السطر | المورد التاريخي وتوزيع الحالة والكمية |
| Status/lifecycle | `RequestStatusHistory` | توزيع حالي وأحداث وفَنَل ومدد |
| Approvals | `RequestApproval` + history | قرارات المدير/الفرع ومعدلات الأحداث |
| Warehouse | وصول المستودع + history + snapshots | أحداث ومعالجة وفروع وموردون وأصناف |

## التاريخ واللقطات والنطاق

كل تقارير الأسطر تستعمل `supplierCodeSnapshot` و`supplierNameSnapshot` و`requestedQuantity` و`conversionFactorSnapshot` و`baseQuantitySnapshot`. لا يُعاد اختيار المورد الأساسي الحالي ولا يعاد حساب عامل التحويل من تكوين الوحدة الحالي. وتستبعد كل مجاميع الطلب النشطة السطور `excluded`.

فترة التقرير الافتراضية آخر 30 يومًا، وترسل قيم UTC بصيغة ISO. يرفض الخادم `to < from`، ويقيد الفترة إلى 366 يومًا. تستخدم تقارير نشاط الطلبات `submittedAt`، بينما تستخدم الانتقالات والتحويلات الزمنية `RequestStatusHistory.occurredAt`.

## API والأمن

تسجل `ReportsController` مساحة `GET /api/v1/reports/*` فقط؛ لا توجد عملية كتابة ضمنها. يتحقق Zod من UUID والصفحات والحجم والفرز والاتجاه وأنواع التقرير. الحجم الأقصى للصفحة 100، وحجم CSV 5,000 صف. يعاد تطبيق الصلاحية والنطاق والفلاتر داخل كل خدمة، ولا يستطيع `branchId` القادم من العميل توسيع نطاق المستخدم.

يضع CSV BOM لعرض العربية/الإنجليزية/الأردية، ويرتب الأعمدة بثبات من صفوف الخادم، ويقتبس الخلايا، ويضيف apostrophe إلى أي قيمة تبدأ بـ`=` أو `+` أو `-` أو `@`. لا يتضمن payloads للتدقيق أو أسرارًا أو جلسات.

## الواجهة والدليل المرئي

أضيف مسار `#/reports` والتنقل المقيد ببيانات القدرة، وفلاتر الفترة/الفرع/الحالة/البحث، وثمانية تبويبات، وحالات loading/empty/error/offline، وإتاحة تصدير وفق `reports.export`. تحققت لقطات فعلية من Dashboard عربي RTL، Dashboard إنجليزي LTR، Warehouse أردي RTL، وجميع أسطح التقارير، وحالة offline، وحالة export-ready، وواجهة 893×768 tablet/narrow. استُخدمت fixtures مؤقتة ثم نُظفت من TiDB.

## التحقق

| البوابة | النتيجة |
|---|---|
| Phase 9 focused integration | 5/5 PASS |
| Phase 9 UI contract | 4/4 PASS |
| الانحدار المستهدف | 8 ملفات، 49/49 PASS |
| الانحدار الكامل | 26 ملفًا، 102/102 PASS |
| Prisma validate/generate | PASS |
| TypeScript | PASS |
| Production build/PWA | PASS؛ تم توليد Service Worker و64 إدخال precache |
| مخطط/مهاجرات | لا فرق؛ hashes موثقة في `phase9/database_unchanged_evidence.md` |

قاس اختبار TiDB التمثيلي Dashboard وتقرير الطلبات بعد إضافة 12 طلبًا مؤقتًا قابلًا للتنظيف. في الانحدار الكامل سجل Dashboard **3,791ms** وتقرير الطلبات **4,625ms**. القياس ملاحظة بيئة اختبار محلية/TiDB وليس SLA إنتاجيًا. لا توجد معاملات تفاعلية طويلة للتقارير، وتستخدم الخدمة تحميلات include ومعاملات قراءة مجمعة للطلب المفصل بدل N+1.

## القيود المعروفة

> **NON-BLOCKING / REMEDIATION:** harness الواجهة الحالي يختبر عقد المصدر ولا يملك DOM interaction component harness. عُوّض ذلك بمتصفح فعلي وfixtures مقيدة. كما بقي تحذير bundle أكبر من 500KB في بناء Vite؛ لم يُنفذ code-splitting لأنه عمل تحسين Phase 10 محظور بالعقد.

لا توجد عيوب حاجبة معروفة. يظل القبول النهائي مرهونًا بمراجعة مستقلة وفق قاعدة التوقف.

OPERATIONAL DASHBOARD IMPLEMENTED: YES

REQUEST REPORT IMPLEMENTED: YES

BRANCH REPORT IMPLEMENTED: YES

ITEM SNAPSHOT REPORT IMPLEMENTED: YES

SUPPLIER SNAPSHOT REPORT IMPLEMENTED: YES

STATUS LIFECYCLE REPORT IMPLEMENTED: YES

APPROVAL PERFORMANCE REPORT IMPLEMENTED: YES

WAREHOUSE PROCESSING REPORT IMPLEMENTED: YES

REPORTS VIEW SERVER AUTHORIZATION VERIFIED: YES

REPORTS EXPORT SERVER AUTHORIZATION VERIFIED: YES

REPORT BRANCH SCOPE ENFORCED SERVER SIDE: YES

HISTORICAL SUPPLIER SNAPSHOTS USED FOR REPORTING: YES

HISTORICAL BASE QUANTITY SNAPSHOTS USED FOR REPORTING: YES

STATUS HISTORY USED FOR LIFECYCLE TIMING: YES

CSV EXPORT FORMULA INJECTION PROTECTION VERIFIED: YES

ARABIC RTL REPORTING UI VERIFIED: YES

ENGLISH LTR REPORTING UI VERIFIED: YES

URDU RTL REPORTING UI VERIFIED: YES

FULL REGRESSION PASSED: YES

PHASE 9 FOCUSED TESTS PASSED: YES

PRISMA SCHEMA CHANGED: NO

PRISMA MIGRATIONS CHANGED: NO

UNEXPLAINED DATABASE DRIFT: NO

PHASE 10 STARTED: NO

BLOCKING DEFECTS REMAIN: NO

PHASE 9 READY FOR INDEPENDENT REVIEW: YES
