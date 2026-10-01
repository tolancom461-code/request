# تقرير إغلاق P-005-C1 — ذرية عمليات الطلبات المعادة

**المشروع:** نظام طلبات فروع المطاعم  
**النطاق المنفذ:** P-005-C1 فقط — تصحيح B-5-001 لذرية تعديل وإضافة أسطر الطلبات ذات الحالة `returned`  
**الحالة:** مكتمل فنيًا ومهيأ لمراجعة بوابة مستقلة؛ لم تبدأ Phase 6.

## الملخص التنفيذي

عالج هذا التصحيح العيب **B-5-001** في مسار الطلب المعاد. كان `RequisitionService` يبدأ معاملة Prisma خارجية لقفل الطلب والتحقق من `rowVersion`، ثم يستدعي دوال عامة في `RequestLinePreparationService` تفتح معاملات Prisma مستقلة. لذلك كان يمكن أن تُحفظ كمية صحيحة في معاملة مستقلة ثم تفشل صلاحية الوحدة في معاملة لاحقة، بينما تتراجع المعاملة الخارجية ولا تزيد النسخة؛ فتظهر استجابة فشل مع بقاء جزء من تعديل العمل محفوظًا.

أصبح مسارا تعديل السطر وإضافة/تحديث السطر المعاد يمران الآن بالمعاملة التفاعلية نفسها من قفل سجل الطلب والتحقق من النسخة والحالة التاريخية، إلى تحقق الكمية والوحدة أو بناء اللقطة، وكتابة السطر وسجل التدقيق، وزيادة `rowVersion` مرة واحدة، ثم قراءة التفاصيل من الحالة الملتزمة نفسها. لا يفتح مسار HTTP في Phase 5 أي معاملة جذرية متداخلة.

> الدوال العامة الموروثة `changeReturnedLineQuantity` و`changeReturnedLineUnit` و`addReturnedLine` أبقيت فقط لتوافق اختبارات Phase 2A المقبولة. إنها **ليست** جزءًا من مسار HTTP المصحح؛ مسار HTTP يستدعي حصريًا helpers التي تستقبل `Prisma.TransactionClient` الموجود.

## سبب العيب وحدود المعاملة الجديدة

| المسار | السلوك السابق المعيب | السلوك بعد P-005-C1 | أثر الذرية |
|---|---|---|---|
| تعديل سطر معاد | معاملة خارجية تتبعها معاملة مستقلة للكمية ثم معاملة مستقلة للوحدة | `lockRequest` ثم `changeReturnedLineInTransaction(tx, ...)` ثم `bumpLockedRequestVersion(tx, ...)` داخل معاملة واحدة | فشل أي تحقق أو كتابة يتراجع معه السطر والتدقيق والنسخة معًا |
| إضافة/تحديث سطر معاد | اختيار سطر أو إنشاء سطر داخل معاملة خارجية، مع عمليات كمية/وحدة أو إضافة عبر معاملات مستقلة | `lockRequest` ثم البحث عن السطر النشط ثم `changeReturnedLineInTransaction` أو `addReturnedLineInTransaction` ثم زيادة النسخة داخل المعاملة نفسها | لا توجد إضافة جزئية أو تدقيق يتيم أو انحراف في النسخة |

في `changeReturnedLineInTransaction` تُتحقق الكمية الموجبة والسطر النشط وتطابق `BranchItem` والوحدة النشطة التابعة لعنصر اللقطة. ويُحدَّث كل من الكمية والوحدة ومعامل التحويل وكمية الوحدة الأساسية بسجل تدقيق واحد `returned_line_updated`. أما `addReturnedLineInTransaction` فينشئ السطر ولقطته وسجل تدقيقه في `tx` الممرر، ويحافظ على قواعد المورّد الأساسي التاريخية وعلى دلالة `addedAfterFirstSubmission` للسطور التاريخية الجديدة.

## الملفات المعدلة

| الملف | التغيير الفعلي |
|---|---|
| `apps/api/src/requisition.service.ts` | قفل الطلب داخل المعاملة، التحقق من الحالة والنسخة، استدعاء helpers الذرية، وزيادة `rowVersion` مرة واحدة قبل إعادة التفاصيل من المعاملة نفسها. |
| `apps/api/src/request-line-preparation.service.ts` | إضافة helpers واعية بالمعاملة لتعديل السطر وإضافته؛ الإبقاء على wrappers موروثة لا تستخدمها واجهة HTTP. |
| `tests/phase5c1-returned-atomic.integration.test.ts` | إضافة خمسة اختبارات تكامل حقيقية على TiDB لتغطية حالات C1 الإلزامية. |
| `todo.md` | تسجيل تقدم التصحيح وبوابات الإغلاق وحزمة التسليم. |
| `PHASE_5_C1_RETURNED_REQUEST_ATOMICITY_REPORT.md` | هذا التقرير. |
| `evidence/p005-c1/*.md` | مصفوفة القبول وقائمة التغييرات ودليل النطاق وبيان الحزمة. |

لم تُعدّل واجهة المستخدم أو أي API لمدير أو المستودع أو الإشعارات أو التقارير. كما لم تتغير Prisma schema أو Prisma migrations.

## التحقق والاختبارات

نفذت الاختبارات المتسلسلة على TiDB بسبب طبيعة معاملات التكامل. سجل الاختبار المركز في `tests/phase5c1-returned-atomic.integration.test.ts` غطى النتائج التالية.

| الحالة | النتيجة الفعلية | الدليل |
|---|---:|---|
| TC-P5C1-01: فشل تعديل بوحدة أجنبية | PASS | بقيت الكمية والوحدة و`rowVersion` كما هي، ولم يبق سجل تدقيق ناجح. |
| TC-P5C1-02: نجاح تعديل كمية ووحدة | PASS | تغيرت القيم معًا، وزادت `rowVersion` بمقدار واحد، وظهر تدقيق متسق. |
| TC-P5C1-03: فشل إضافة سطر معاد | PASS | لا سطر نشط جزئي ولا تدقيق ناجح ولا تغير في النسخة. |
| TC-P5C1-04: تزامن إضافة/تحديث | PASS | لا ينتج سطر نشط مكرر؛ النسخة القديمة تُرفض؛ يقبل مسار واحد حتميًا. |
| TC-P5C1-05: إعادة تقديم صحيحة | PASS | بقيت أول `submittedAt`، وتُحدّث اللقطات المرجعية، وتتحول الحالة ذريًا إلى `pending_approval`. |

| بوابة التحقق | النتيجة الفعلية |
|---|---|
| الاختبار المركز C1 | ملف واحد، **5/5 PASS**. |
| انحدار Phase 2A المتأثر + C1 | ملفان، **17/17 PASS**. |
| الانحدار الكامل | **18 ملف اختبار / 67 اختبار PASS**، مدة `1122.16s`. |
| `pnpm exec prisma validate` | PASS؛ Prisma schema صالح. |
| `pnpm exec prisma generate` | PASS؛ توليد Prisma Client تم بنجاح. |
| `pnpm run check` | PASS؛ لم يعثر TypeScript على أخطاء. |
| `pnpm run build` | PASS؛ بُني API والويب، وأنتج PWA `generateSW` مع `64` مدخل precache وملفي `sw.js` وWorkbox. |
| تدقيق schema/migrations | PASS؛ لا فرق في `prisma/schema.prisma` أو `prisma/migrations` عن النسخة المتعقبة قبل C1. |

كان تحذير حجم حزمة الويب فوق 500 كيلوبايت موجودًا أثناء البناء لكنه تحذير bundler لا فشل بناء، ولم يُعالج لأنه خارج نطاق هذا التصحيح الخلفي الضيق.

## الأدلة والحزمة

توجد مصفوفة القبول وقائمة الملفات وبصمات Prisma وتفاصيل الأدلة في `evidence/p005-c1/`. تضم حزمة التسليم الضيقة المصدر المصحح والاختبار الجديد وسجلات C1 والانحدار الكامل وبوابة Prisma/البناء وتلك الوثائق. تُفحص الحزمة بـ`unzip -t` ومسح أسرار قبل التسليم. لا تتضمن الحزمة ملفات `.env` أو `.project-config.json` أو `node_modules` أو `dist` أو أي سجل تاريخي يحتوي معلومات اتصال TiDB.

## القيود وحالة المرحلة

هذا الإغلاق يقتصر على B-5-001 ولا يعيد تنفيذ Phase 5. لم يُبدأ أي workflow للمدير أو approve/reject/return أو تسليم للمستودع أو إشعارات أو تقارير. يبقى الانتقال اللاحق موقوفًا حتى **مراجعة مستقلة** وفق قاعدة التوقف في العقد.

RETURNED EDIT USES ONE AUTHORITATIVE TRANSACTION: YES

RETURNED ADD UPSERT USES ONE AUTHORITATIVE TRANSACTION: YES

FAILED RETURNED EDIT ROLLS BACK QUANTITY UNIT AUDIT ROWVERSION: YES

FAILED RETURNED ADD LEAVES NO PARTIAL LINE OR AUDIT: YES

RETURNED MUTATION CONCURRENCY VERIFIED: YES

RETURNED RESUBMISSION REGRESSION PASSED: YES

FULL REGRESSION PASSED: YES

PRISMA SCHEMA CHANGED: NO

PRISMA MIGRATIONS CHANGED: NO

PHASE 6 STARTED: NO

B-5-001 CLOSED: YES

PHASE 5 READY FOR FORWARD GATE REVIEW: YES
