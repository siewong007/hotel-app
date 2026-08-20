BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL client_encoding = 'UTF8';
SET LOCAL standard_conforming_strings = on;
SET LOCAL quote_all_identifiers = off;
SET LOCAL TimeZone = 'UTC';
SET LOCAL DateStyle = 'ISO, MDY';
SET LOCAL IntervalStyle = 'postgres';
SET LOCAL extra_float_digits = 3;
SET LOCAL bytea_output = 'hex';
SET LOCAL lc_numeric = 'C';

WITH inventory AS (
    SELECT
        CASE relation.relkind
            WHEN 'v' THEN 'view'
            ELSE 'table'
        END::text AS kind,
        format('%I.%I', schema_row.nspname, relation.relname) AS identity,
        CASE relation.relkind
            WHEN 'v' THEN format(
                'query=%s;options=%s',
                pg_get_viewdef(relation.oid, false),
                COALESCE(
                    (
                        SELECT string_agg(option, ',' ORDER BY option COLLATE "C")
                        FROM unnest(relation.reloptions) AS option_row(option)
                    ),
                    '<none>'
                )
            )
            ELSE format(
                'relkind=%s;persistence=%s;is_partition=%s;partition_key=%s;parents=%s;partition_bound=%s',
                relation.relkind,
                relation.relpersistence,
                relation.relispartition,
                COALESCE(pg_get_partkeydef(relation.oid), '<none>'),
                COALESCE(parent_row.parents, '<none>'),
                COALESCE(pg_get_expr(relation.relpartbound, relation.oid, true), '<none>')
            )
        END AS definition
    FROM pg_class AS relation
    JOIN pg_namespace AS schema_row ON schema_row.oid = relation.relnamespace
    LEFT JOIN LATERAL (
        SELECT string_agg(
            format('%I.%I', parent_schema.nspname, parent_relation.relname),
            ',' ORDER BY parent_schema.nspname COLLATE "C", parent_relation.relname COLLATE "C"
        ) AS parents
        FROM pg_inherits AS inheritance
        JOIN pg_class AS parent_relation ON parent_relation.oid = inheritance.inhparent
        JOIN pg_namespace AS parent_schema ON parent_schema.oid = parent_relation.relnamespace
        WHERE inheritance.inhrelid = relation.oid
    ) AS parent_row ON true
    WHERE schema_row.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v')

    UNION ALL

    SELECT
        'column',
        format('%I.%I.%I', schema_row.nspname, relation.relname, attribute_row.attname),
        format(
            'ordinal=%s;type=%s;nullable=%s;default=%s;identity=%s;generated=%s',
            attribute_row.attnum,
            format_type(attribute_row.atttypid, attribute_row.atttypmod),
            NOT attribute_row.attnotnull,
            CASE
                WHEN attribute_row.attgenerated = ''
                    THEN COALESCE(pg_get_expr(default_row.adbin, default_row.adrelid, true), '<none>')
                ELSE '<none>'
            END,
            CASE attribute_row.attidentity
                WHEN 'a' THEN 'always'
                WHEN 'd' THEN 'by_default'
                ELSE '<none>'
            END,
            CASE attribute_row.attgenerated
                WHEN 's' THEN 'stored:' || pg_get_expr(default_row.adbin, default_row.adrelid, true)
                WHEN 'v' THEN 'virtual:' || pg_get_expr(default_row.adbin, default_row.adrelid, true)
                ELSE '<none>'
            END
        )
    FROM pg_attribute AS attribute_row
    JOIN pg_class AS relation ON relation.oid = attribute_row.attrelid
    JOIN pg_namespace AS schema_row ON schema_row.oid = relation.relnamespace
    LEFT JOIN pg_attrdef AS default_row
        ON default_row.adrelid = attribute_row.attrelid
       AND default_row.adnum = attribute_row.attnum
    WHERE schema_row.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v')
      AND attribute_row.attnum > 0
      AND NOT attribute_row.attisdropped

    UNION ALL

    SELECT
        'constraint',
        format('%I.%I.%I', schema_row.nspname, relation.relname, constraint_row.conname),
        pg_get_constraintdef(constraint_row.oid, false)
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS schema_row ON schema_row.oid = relation.relnamespace
    WHERE schema_row.nspname = 'public'
      AND constraint_row.contype IN ('p', 'u', 'f', 'c')

    UNION ALL

    SELECT
        'index',
        format('%I.%I', schema_row.nspname, index_relation.relname),
        pg_get_indexdef(index_relation.oid)
    FROM pg_index AS index_row
    JOIN pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
    JOIN pg_class AS table_relation ON table_relation.oid = index_row.indrelid
    JOIN pg_namespace AS schema_row ON schema_row.oid = table_relation.relnamespace
    WHERE schema_row.nspname = 'public'

    UNION ALL

    SELECT
        'function',
        format(
            '%I.%I(%s)',
            schema_row.nspname,
            function_row.proname,
            pg_get_function_identity_arguments(function_row.oid)
        ),
        pg_get_functiondef(function_row.oid)
    FROM pg_proc AS function_row
    JOIN pg_namespace AS schema_row ON schema_row.oid = function_row.pronamespace
    WHERE schema_row.nspname = 'public'
      AND function_row.prokind = 'f'
)
SELECT
    kind || chr(9) ||
    replace(
        replace(replace(replace(identity, E'\\', E'\\\\'), E'\t', E'\\t'), E'\n', E'\\n'),
        E'\r', E'\\r'
    ) || chr(9) ||
    replace(encode(convert_to(definition, 'UTF8'), 'base64'), E'\n', '')
FROM inventory
ORDER BY kind COLLATE "C", identity COLLATE "C";

COMMIT;
