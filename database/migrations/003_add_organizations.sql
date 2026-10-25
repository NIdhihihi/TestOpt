CREATE TABLE organizations (
    organization_id VARCHAR(50) PRIMARY KEY,
    organization_name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE organization_members (
    organization_id VARCHAR(50) NOT NULL,
    user_id VARCHAR(50) NOT NULL,
    role ENUM('OWNER', 'ADMIN', 'TEST_MANAGER', 'DEVELOPER', 'VIEWER') NOT NULL DEFAULT 'DEVELOPER',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, user_id),
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

INSERT INTO organizations (organization_id, organization_name)
SELECT 'ORG_DEFAULT', 'Default organization'
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE organization_id = 'ORG_DEFAULT');

ALTER TABLE projects ADD COLUMN organization_id VARCHAR(50) NULL;
UPDATE projects SET organization_id = 'ORG_DEFAULT' WHERE organization_id IS NULL;
ALTER TABLE projects MODIFY organization_id VARCHAR(50) NOT NULL;
ALTER TABLE projects ADD CONSTRAINT fk_projects_organization
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id);
