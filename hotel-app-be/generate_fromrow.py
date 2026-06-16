import re
import os
import glob

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # Find structs that derive FromRow and contain Decimal
    struct_pattern = re.compile(r'#\[derive\((.*?FromRow.*?)\)\]\s*(?:#\[.*?\]\s*)*pub struct (\w+) \{(.*?)\}', re.DOTALL)
    
    new_content = content
    
    for match in struct_pattern.finditer(content):
        derives = match.group(1)
        struct_name = match.group(2)
        fields_str = match.group(3)
        
        if 'Decimal' not in fields_str:
            continue
            
        print(f"Found {struct_name} in {filepath}")
        
        # Remove FromRow from derives
        new_derives = derives.replace('FromRow, ', '').replace(', FromRow', '').replace('FromRow', '')
        
        # Update struct definition
        struct_def = match.group(0)
        new_struct_def = struct_def.replace(derives, new_derives)
        new_content = new_content.replace(struct_def, new_struct_def)
        
        # Parse fields
        field_pattern = re.compile(r'(?:#\[.*?\]\s*)*pub (\w+): (.*?)(?:,|$)')
        fields = []
        for f_match in field_pattern.finditer(fields_str):
            field_name = f_match.group(1)
            field_type = f_match.group(2).strip()
            fields.append((field_name, field_type))
            
        # Generate impl FromRow
        impl_code = f"""
impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for {struct_name} {{
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {{
        use sqlx::Row;
        Ok({struct_name} {{
"""
        for name, ftype in fields:
            if ftype == 'Decimal' or ftype == 'rust_decimal::Decimal':
                impl_code += f"""            {name}: {{
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_decimal(&row.try_get::<String, _>("{name}")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("{name}")?;
                val
            }},
"""
            elif ftype == 'Option<Decimal>' or ftype == 'Option<rust_decimal::Decimal>':
                impl_code += f"""            {name}: {{
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(row.try_get::<Option<String>, _>("{name}")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("{name}")?;
                val
            }},
"""
            else:
                impl_code += f'            {name}: row.try_get("{name}")?,\n'
                
        impl_code += f"""        }})
    }}
}}
"""
        new_content += "\n" + impl_code

    with open(filepath, 'w') as f:
        f.write(new_content)

for filepath in glob.glob("src/models/*.rs"):
    process_file(filepath)

