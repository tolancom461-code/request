# تقرير تصحيح P-004-C1 — المورد الأساسي الفعّال زمنيًا

## ملخص التصحيح

ينفذ هذا العمل **تصحيح P-004-C1 فقط**. كان اختيار المورد الأساسي في لقطة الطلب يعتمد على `activePrimaryBranchItemId` المخزن، ولا يفرض نافذة `effectiveFrom`/`effectiveTo` ولا حالة كل الكيانات التشغيلية عند وقت اللقطة. أصبح القرار الآن مبنيًا على قاعدة زمنية مركزية؛ الحارس المخزن أصبح مرآة مساعدة للأداء والتشخيص، وليس مصدر الحقيقة.

> لا يوجد scheduler أو cron أو مهمة خلفية في التصحيح. تنتقل الأولوية بين الموردين المجدولين تلقائيًا لأن اختيار اللقطة يعيد تقييم النافذة الزمنية في كل عملية إعداد/إرسال للطلب.

| البند | النتيجة |
|---|---|
| مصدر الحقيقة الحالي | مورد أساسي واحد فقط يطابق `active + isPrimary + effectiveFrom ≤ asOf + (effectiveTo فارغ أو ≥ asOf)`، مع BranchItem/Branch/Item/Supplier فعّالة. |
| مورد مستقبلي | لا يختار قبل تاريخ البدء؛ يختار في اليوم الفعّال من دون تعديل تكوين. |
| مورد منتهي | لا يختار بعد تاريخ النهاية. |
| تداخل نافذتين أساسيتين فعالتين | يرفض داخل transaction بعد قفل `branch_items` المعني. |
| غموض تاريخي موجود مسبقًا | يسبب `409 Conflict` آمنًا ولا يختار صفًا عشوائيًا. |
| الحارس `activePrimaryBranchItemId` | يُصفّر ثم يُصالح عند عمليات المورد/BranchItem/حالة المورد؛ لا يقرر اللقطة. |
| Prisma schema/migrations | لم تتغير. |
| Phase 5 | **NOT STARTED**. |

## التنفيذ الفعلي

أضيفت `PrimarySupplierTemporalService` بوصفها نقطة الحقيقة الوحيدة لاختيار المورد الأساسي الحالي ومصالحة الحارس. تطبّع التاريخ إلى اليوم UTC، وتستعلم عن العلاقات الفعالة ضمن النافذة، وتتحقق من حالة فرع العنصر والفرع والعنصر والمورد. إذا لم يوجد صف مطابق، تعيد الخدمة `null` ويظهر خطأ تكوين مضبوط. وإذا وجدت أكثر من علاقة أساسية فعالة في نفس النافذة بسبب بيانات تاريخية مخالفة، ترمي `ConflictException` بدل التعامل مع أول نتيجة فقط.

عدّلت مسارات تكوين Phase 4 ومسار سلامة البيانات الموروث بحيث يمران على منع التداخل نفسه. يُقفل `branch_items` داخل المعاملة قبل فحص التداخل ثم تُجرى الكتابة والمصالحة في المعاملة نفسها. لا تُحوّل العلاقة المجدولة إلى non-primary عند إنشاء علاقة لاحقة؛ تبقى علاقتين أساسيتين مسموحتين إذا كانت نافذتاهما غير متداخلتين. وعند تغيّر حالة BranchItem أو المورد، أو إعادة تفعيله، تُعاد مصالحة الحارس من المصدر الزمني.

تم تعديل `RequestLinePreparationService` فقط في نقطة إعداد لقطة السطر. يتحقق من صلاحية BranchItem والفرع والعنصر، ثم يستدعي المحدد الزمني للحصول على المورد في وقت اللقطة. لذلك يسري التصحيح على إنشاء مسودة السطر وعلى تحديث اللقطات السلطوية عند الإرسال الأول أو إعادة الإرسال، من دون إضافة API أو workflow لمرحلة لاحقة.

## التحقق المنفذ

| الفحص | النتيجة | الدليل |
|---|---|---|
| اختبارات C1 الزمنية | PASS — 4 اختبارات TiDB | `evidence/phase4c1/phase4c1_focused_temporal.log` |
| نزاهة لقطة الطلب الموروثة | PASS — 12 اختبارًا | `evidence/phase4c1/phase4c1_targeted_final.log` |
| Phase 4 المتأثر + C1 | PASS — 8 اختبارات | `evidence/phase4c1/phase4c1_phase4_and_temporal_retest.log` |
| الانحدار الكامل | PASS — **14 ملفًا / 53 اختبارًا** | `evidence/phase4c1/phase4c1_full_regression_final.log` |
| TypeScript | PASS | مُضمن في سجل التحقق المستهدف. |
| Prisma validate | PASS | `evidence/phase4c1/prisma_validate.log` |
| بناء الإنتاج وPWA | PASS — 64 مدخل precache | `evidence/phase4c1/production_build.log` |
| تدقيق النطاق | PASS | `evidence/phase4c1/scope_audit.log` |

تغطي الاختبارات المستقبل قبل البداية، وبدء الصلاحية، ونهاية الصلاحية، والانتقال المجدول بين نافذتين غير متداخلتين، ورفض التداخل، وتعطيل/إعادة تفعيل BranchItem، وتعطيل/إعادة تفعيل المورد، ورفض لقطة مورد مستقبلي، وفشل الغموض التاريخي بأمان، ثم العودة لاختيار المورد الوحيد بعد إزالة الغموض.

## حدود وتصريحات صريحة

لم يتغير Prisma schema أو أي migration أو Redis أو TiDB session fallback أو متغيرات البيئة أو UI أو PWA أو endpoints جديدة. لا توجد بيانات اختبار دائمة أُنشئت للتصحيح؛ تنفذ اختبارات C1 تنظيفًا للـfixtures. ولا توجد لقطة واجهة جديدة لأن التصحيح ليس تغيّرًا مرئيًا؛ دليل القبول هو اختبارات TiDB والبناء وتدقيق النطاق.

يصدر build تحذير حجم chunk للواجهة وتحذير `baseline-browser-mapping` غير حاجبين، وهما موروثان من بناء Phase 4 ولا علاقة لهما بقواعد المورد الزمني. لا تبرر هذه التحذيرات تغييرًا خارج نطاق C1.

## سطور الإغلاق

P-004-C1 TEMPORAL PRIMARY SUPPLIER CORRECTION COMPLETE: YES

AUTHORITATIVE SNAPSHOT SELECTION IS DATE-AWARE: YES

OVERLAPPING ACTIVE PRIMARY WINDOWS REJECTED: YES

LEGACY AMBIGUITY FAILS SAFELY: YES

PRISMA SCHEMA CHANGED: NO

PRISMA MIGRATIONS CHANGED: NO

REDIS OR SESSION CONFIGURATION CHANGED: NO

PHASE 5 STARTED: NO

CORRECTION PACKAGE PREPARED: YES

## حزمة التصحيح الضيقة

تم إنشاء `Restaurant_Branch_Requisition_P004_C1_Temporal_Primary_Supplier_Correction_Package.zip` من ملف التصحيح والأدلة المطلوبة فقط. اجتازت الحزمة فحص أسماء الأسرار والقيم الحرفية، واختبار `unzip -t`، وملف SHA-256 جانبي للتحقق. لا تضم الحزمة مصدر المشروع الكامل أو مخرجات `dist` أو تبعيات محلية أو ملفات بيئة؛ راجع `phase4c1/P004_C1_PACKAGE_MANIFEST.md`.
