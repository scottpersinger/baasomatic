# Insta-API Node App

Settings
 
    DATABASE_URL - points to the database
    MASTER_API_USER - master API key username
    MASTER_API_KEY - master API key secret
    REGISTRATION_VERIFY - Set to a non-empty value to require registrations to verify their email address
    USER_TABLE - configures the user table. Format is: <table name>,<column specs>

    Define the table to store user identity records. Column names are configurable via
    the column specs, which just map logical column names to physical column names.

    Logical columns include: username, email, crypted_password, salt
    By default the physical column names will be assumed to use these same names. Otherwise
    you can remap like:
       users,username=users_name,email=user_email



Configured to connect to a database, it automatically exposes a REST interface for interacting with the
database.

The rest endpoints look like:

   /tables - get metadata on all tables
   /tables/<table>
      GET - retrieve rows from the table
      POST - insert a row in the table
      PATCH - update multiple rows in the table
      DELETE - delete multiple rows in the table
   /tables/<table>/<row pk>
      GET - retrieve a single row by primary key
      PATCH - update a single row by primary key
      DELET - delete a single row by primary key
   /tables/<table>/$meta
      GET - returns the table structure
      POST - pass a table definition to create a new table, a dict mapping column names to types, like:
            {"id":"key", "name:":"string,20", "email":"string,512", "date":"date"}
  /tables/<table>/$count
      GET - returns the count of (visible) rows in the table

  Query parameters:
      schema - Use an alternate schema from 'public'
      filter - Specify a filter clause for GET, PATCH, DELETE
      offset, limit - Specify offset and limit for GET

  Headers
      Authorization - specify a session id

## Payloads and return values

All POST/PATCH payloads should be JSON documents.

Return values are always JSON documents, like:
     {result: [success,error]
      error: {code: <code>, message: <message>}
     ...}

The 'result' property is always present. The 'error' property is present if result='error'.


## Authentication

    /login
      POST - Specify username and password. Master login with MASTER_API_USER and MASTER_API_KEY
      returns: {sessionId: <session id>} or error result
  
    /register
      POST - Specify a username, email, and password.
      Returns either an error, or optionally:
        {activation: "required"}
      If activation is not required then the client can immediately call /login with
      the username and password to get a sessionId.

## Access Control

Logically, access control allows the master user to specify the access rights on each
table in the database. Permissions are indicated "unix style", so that for each
table you can specify separate Read, Write, and List permissions for each of 
these levels:
    owner   - owner of the row in the table
    group   - group that owns the row in the table
    role    - role assigned to the user (entire table)

The following roles are predefined:

    admin   - Users with admin privileges
    guest   - Any authenticated user
    world   - Allows non-authenticated access

A table that uses `owner` or `group` permissions must define user id or group id
columns respectively. The indicated permissions apply to the rows in the table
matching the current user's id or group id.

Role-based permission applies to all rows in a table. So if a table has "guest read"
permission than any authenticated user can read all rows in the table.

Internally access control information is stored declaratively in the database. The idea is to 
allow trusted server-side code to easily evaluate the access control rules by interacting
directly with the database.

     /tables/<table>/$acl
       POST:
          table - table name (may be schema qualified)
          level : value
              `level` is one of user, group, role.<role>
              `value` is comma separated, any of `read`,`write`,`list` or the shortcut `all`.
          user_column - Name of the column containing the user id (defaults to `user_id`)
          group_column - Name of the column containing the group id (defaults to `group_id`)

        GET
          Returns the access control rows define for the table:
            [{<level>: {read: [true/false], write: [true/false]}}, ...]

    /tables/<table>/$acl/<level>
        DELETE
            Delete the perms for this level on the indicated table


     /roles 
         GET - list all roles

     /roles/<role>
         GET - list users that have this role
         POST user_id - Add the indicated user to the role
         DELETE user_id - Delete the user from the role


### Access control examples

*Public read/write access*

table1: {"guest": "read,write,list"}

This perm indicates that any authenticated user may read and write any rows in the table.
You might use this for the pages of a pubically editable wiki for example.

*User private access*

preferences: {"user": "all", "user_column" : "owner_id"}

    Note that `all` is a shortcut for enabling read/write/list.

This perm indicates that the "preferences" table has an owner_id column. Users may
write rows and read only rows that they own.

*User writeable, world readable*

posts: {"user": "all", "role.world": "read,list"}

This perm would be appropriate for something like a public activity stream. Users
can write and update their own posts, and anybody can read the posts created by
any user.

*Group permissions*

A user may belong to one or more groups. 

*Admin moderator rules*

posts: {"moderator": "all"}

We can add a perm that allows users with the "admin" role the ability to edit
posts made by other users.

### Access control schema

Access control perms are stored in the special `_access_control` table:

    table       |    level   |    read |   write  |   list   | user_column | group_column
    --------------------------------------------------------------------------------------
    table1      | public     |       t |       t  |      t   |             |
    preferences | user       |       t |       t  |      t   | user_id     | 
    posts       | user       |       t |       t  |      t   | user_id     |
    posts       | role.world |       t |       f  |      t   |             |
    posts       | role.admin |       t |       t  |      t   |             |


The list of roles a user belongs to are stored in the `_roles` table:

    user_id     | role   
    ---------------------------------
    1           | admin
    2           | admin 
    3           | superuser

